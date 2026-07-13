const STORAGE_KEY = 'superstar_hockey_save';

export class StorageManager {
    constructor() {
        this.data = this.load();
    }

    load() {
        try {
            const str = localStorage.getItem(STORAGE_KEY);
            if (str) return JSON.parse(str);
        } catch (e) {
            console.warn('Could not load save data', e);
        }
        return this.getDefaults();
    }

    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.warn('Could not save data', e);
        }
    }

    getDefaults() {
        return {
            volume: 1.0,
            matchesPlayed: 0,
            wins: 0,
            losses: 0,
            lastTeamIndex: 0
        };
    }
}
