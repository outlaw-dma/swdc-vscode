import * as music from "cody-music";
import { MusicPlayerManagerSingleton } from "./MusicPlayerManager";
import { showQuickPick } from "../MenuManager";
import { serverIsAvailable, getSpotifyAccessToken } from "../DataController";
import { getItem, setItem, isEmptyObj } from "../Util";
import {
    softwareGet,
    softwarePut,
    spotifyApiGet,
    hasTokenExpired,
    isResponseOk
} from "../HttpClient";
import { MusicStoreManager, Playlist, Track } from "./MusicStoreManager";
import { api_endpoint } from "../Constants";
import { MusicStateManagerSingleton, TrackState } from "./MusicStateManager";

const store: MusicStoreManager = MusicStoreManager.getInstance();

export class MusicControlManager {
    getPlayer(): string {
        const trackState = MusicPlayerManagerSingleton.getTrackState();
        if (trackState) {
            return trackState.type;
        }
        return null;
    }

    async next() {
        const player = this.getPlayer();
        if (player) {
            await music.next(player);
            MusicPlayerManagerSingleton.updateButtons();
        }
    }
    async previous() {
        const player = this.getPlayer();
        if (player) {
            await music.previous(player);
            MusicPlayerManagerSingleton.updateButtons();
        }
    }
    async play() {
        const player = this.getPlayer();
        if (player) {
            await music.play(player);
            MusicPlayerManagerSingleton.updateButtons();
        }
    }
    async pause() {
        const player = this.getPlayer();
        if (player) {
            await music.pause(player);
            MusicPlayerManagerSingleton.updateButtons();
        }
    }

    launchPlayerMenu() {
        let menuOptions = {
            items: []
        };

        menuOptions.items.push({
            label: "Launch Spotify",
            description: "",
            detail: "Launch your Spotify player",
            url: null,
            uri: null,
            cb: launchSpotifyPlayer
        });

        menuOptions.items.push({
            label: "Launch iTunes",
            description: "",
            detail: "Launch your iTunes player",
            url: null,
            uri: null,
            cb: launchItunesPlayer
        });

        showQuickPick(menuOptions);
    }

    async setLiked(liked: boolean) {
        const trackState: TrackState = await MusicStateManagerSingleton.getState();
        if (trackState && trackState.track && !isEmptyObj(trackState.track)) {
            // set it to liked
            let trackId = trackState.track.id;
            if (trackId.indexOf(":") !== -1) {
                // strip it down to just the last id part
                trackId = trackId.substring(trackId.lastIndexOf(":") + 1);
            }
            const type = trackState.type;
            // use the name and artist as well since we have it
            let trackName = encodeURIComponent(trackState.track.name);
            let trackArtist = encodeURIComponent(trackState.track.artist);
            const api = `/music/liked/track/${trackId}/type/${type}?name=${trackName}&artist=${trackArtist}`;
            const payload = { liked };
            const resp = await softwarePut(api, payload, getItem("jwt"));
            if (isResponseOk(resp)) {
                if (type === "itunes") {
                    music
                        .setItunesLoved(liked)
                        .then(result => {
                            console.log("updated itunes loved state");
                        })
                        .catch(err => {
                            console.log(
                                "unable to update itunes loved state, error: ",
                                err.message
                            );
                        });
                }
                // update the buttons
                MusicStateManagerSingleton.clearServerTrack();
                MusicPlayerManagerSingleton.stateCheckHandler();
            }
        }
    }

    async showMenu() {
        let menuOptions = {
            items: []
        };

        menuOptions.items.push({
            label: "Software Top 40",
            description: "",
            detail:
                "Top 40 most popular songs developers around the world listen to as they code",
            url: "https://api.software.com/music/top40",
            uri: null,
            cb: null
        });

        menuOptions.items.push({
            label: "Connect Spotify",
            description: "",
            detail:
                "To see your Spotify playlists in Music Time, please connect your account",
            url: `${api_endpoint}/auth/spotify`,
            uri: null,
            cb: null
        });

        menuOptions.items.push({
            label: "Search Playlist",
            description: "",
            detail: "Find a playlist",
            url: null,
            uri: null,
            cb: buildPlaylists
        });

        showQuickPick(menuOptions);
    }
}

export async function launchSpotifyPlayer() {
    music.startSpotifyIfNotRunning().then(result => {
        MusicPlayerManagerSingleton.stateCheckHandler();
    });
}

export async function launchItunesPlayer() {
    music.startItunesIfNotRunning().then(result => {
        MusicPlayerManagerSingleton.stateCheckHandler();
    });
}

export async function buildPlaylists() {
    let playlists = store.getPlaylists();
    if (playlists.length > 0) {
        return playlists;
    }

    let api = `/v1/me/playlists?offset=0&limit=20`;
    let accessToken = getItem("spotify_access_token");
    let playlistResponse = await spotifyApiGet(api, accessToken);
    // check if the token needs to be refreshed
    playlistResponse = await checkSpotifyApiResponse(playlistResponse, api);

    if (!isResponseOk(playlistResponse)) {
        return;
    }

    //href:"https://api.spotify.com/v1/playlists/0mwG8hCL4scWi8Nkt7jyoV/tracks"
    //uri, name, public, collaborative, tracks: {total: 3}
    await populatePlaylists(playlistResponse, playlists, accessToken);

    // are there any more pages?
    while (playlistResponse.data.next !== null) {
        playlistResponse = await spotifyApiGet(
            playlistResponse.data.next,
            accessToken
        );
        if (isResponseOk(playlistResponse)) {
            await populatePlaylists(playlistResponse, playlists, accessToken);
        } else {
            break;
        }
    }

    store.setPlaylists(playlists);

    return playlists;
}

async function populatePlaylists(
    playlistResponse: any,
    playlists: Playlist[],
    accessToken: string
) {
    if (isResponseOk(playlistResponse)) {
        const data = playlistResponse.data;
        if (data && data.items) {
            for (let i = 0; i < data.items.length; i++) {
                // populate the playlists
                const playlistItem = data.items[i];
                let playlist = new Playlist();
                playlist.player = "spotify";
                playlist.id = playlistItem.id;
                playlist.uri = playlistItem.uri;
                playlist.collaborative = playlistItem.collaborative;
                playlist.name = playlistItem.name;
                playlist.public = playlistItem.public;

                let tracks = [];
                // get the tracks
                if (playlistItem.tracks) {
                    const trackReponse = await spotifyApiGet(
                        playlistItem.tracks.href,
                        accessToken
                    );
                    const trackData = trackReponse.data;
                    if (trackData && trackData.items) {
                        for (let x = 0; x < trackData.items.length; x++) {
                            // populate the tracks
                            const trackItemData = trackData.items[x];
                            if (trackItemData.track) {
                                const trackItem = trackItemData.track;
                                let track = new Track();
                                track.duration_ms = trackItem.duration_ms;
                                track.name = trackItem.name;
                                track.explicit = trackItem.explicit;
                                track.disc_number = trackItem.disc_number;
                                track.popularity = trackItem.popularity;
                                track.id = trackItem.id;
                                track.uri = trackItem.uri;
                                // set the artist
                                if (trackItem.artists) {
                                    const len = trackItem.artists.length;
                                    let artistNames = [];
                                    for (let y = 0; y < len; y++) {
                                        const artist = trackItem.artists[y];
                                        artistNames.push(artist.name);
                                    }
                                    track.artist = artistNames.join(", ");
                                }

                                if (trackItem.album) {
                                    track.album = trackItem.album.name;
                                }
                                tracks.push(track);
                            }
                        }
                    }
                }
                playlist.tracks = tracks;
                playlists.push(playlist);
            }
        }
    }
}

export async function getCurrentTrack() {
    let api = "/v1/me/player/currently-playing";
    let accessToken = getItem("spotify_access_token");
    // /v1/me/player/currently-playing
    let response = await spotifyApiGet(api, accessToken);
    // check if the token needs to be refreshed
    response = await checkSpotifyApiResponse(response, api);
    if (isResponseOk(response)) {
        //
    }
}

export async function checkSpotifyApiResponse(response: any, api: string) {
    if (hasTokenExpired(response)) {
        await refreshToken();
        const accessToken = getItem("spotify_access_token");
        // call get playlists again
        response = await spotifyApiGet(api, accessToken);
    }
    return response;
}

export async function refreshToken() {
    let serverIsOnline = await serverIsAvailable();
    const jwt = getItem("jwt");
    // refresh the token then try again
    const refreshResponse = await softwareGet(
        "/auth/spotify/refreshToken",
        jwt
    );
    if (isResponseOk(refreshResponse)) {
        // get the user then get the playlists again
        let accessToken = await getSpotifyAccessToken(serverIsOnline);
        if (accessToken) {
            setItem("spotify_access_token", accessToken);
        }
    }
}
