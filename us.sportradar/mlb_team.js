// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
// vim: syntax=javascript
//
// Copyright 2016 Riad S. Wahby <rsw@cs.stanford.edu>
// based on us.sportradar device by Giovannni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details

const Tp = require('thingpedia');

const API_KEY = 'tn5sx574v9yk995cc29ccftz';
const SCHEDULE_URL = 'https://api.sportradar.us/mlb-t5/games/%d/%d/%d/schedule.xml?api_key=' + API_KEY;
const BOXSCORE_URL = 'https://api.sportradar.us/mlb-t5/games/%s/boxscore.xml?api_key=' + API_KEY;
const POLL_INTERVAL = 24 * 3600 * 1000; // 1 day

module.exports = new Tp.ChannelClass({
    Name: 'SportRadarMLBChannel',
    Extends: Tp.HttpPollingTrigger,
    interval: POLL_INTERVAL,

    _init: function(engine, device, params) {
        this.parent();
        this.engine = engine;

        this._params = params.slice(0, 1);
        this._observedTeam = params[0];
        if (!this._observedTeam)
            throw new TypeError("Missing required parameter");

        this._updateUrl();
        this.filterString = this._params.join('-');

        this._gameId = null;
        this._nextGameTimer = null;
        this._lastStatus = null;
    },

    _doClose: function() {
        clearTimeout(this._nextGameTimer);
        this._nextGameTimer = null;
        return this.parent();
    },

    _updateUrl: function() {
        var now = new Date;
        this.url = SCHEDULE_URL.format(now.getFullYear(), now.getMonth() + 1, now.getDate());
    },

    formatEvent(event) {
        var watchedAlias = event[0];
        var otherAlias = event[1];
        var watchedIsHome = event[2];
        var awayName = event[3];
        var homeName = event[4];
        var gameStatus = event[5];
        var scheduledTime = event[6];
        var inning = event[7];
        var awayRuns = event[8];
        var homeRuns = event[9];
        var result = event[10];

        var platform = this.engine.platform;
        switch(gameStatus) {
        case 'scheduled':
            return "Next game %s @ %s at %s".format(awayName, homeName, scheduledTime.toLocaleString(platform.locale, { timeZone: platform.timezone }));
        case 'inprogress':
            return "Game update for %s @ %s: %d - %d".format(awayName, homeName, awayRuns, homeRuns);
        case 'closed':
            return "Final score for %s @ %s: %d - %d".format(awayName, homeName, awayRuns, homeRuns);
        }
        return [];
    },

    _emit: function(status, inning, awayRuns, homeRuns) {
        var currentEvent = [ this._awayAlias, this.homeAlias, false,
                             this._awayName, this._homeName, status,
                             this._scheduledTime, inning, awayRuns, homeRuns,
                             'unclosed'];

        if (this._observedTeam === this._homeAlias) {
            currentEvent[0] = this._homeAlias;
            currentEvent[1] = this._awayAlias;
            currentEvent[2] = true;
        }
        if (status === 'closed') {
            if (awayRuns === homeRuns) 
                currentEvent[10] = 'draw';
            if (this._observedTeam === this._homeAlias && homeRuns > awayRuns)
                currentEvent[10] = 'win';
            else if (this._observedTeam === this._awayAlias && homeRuns < awayRuns)
                currentEvent[10] = 'win';
            else
                currentEvent[10] = 'lose';
        }

        this.emitEvent(currentEvent);
    },

    _onNextGameEvent: function() {
        Tp.Helpers.Http.get(BOXSCORE_URL.format(this._gameId)).then(function(response) {
            return Tp.Helpers.Xml.parseString(response);
        }).then(function(parsed) {
            var inning = null;
            if (parsed.game.$.status === 'closed' || parsed.game.$.status === 'complete') {
                inning = String(parsed.game.final[0].$.inning_half) + String(parsed.game.final[0].$.inning);
                this._nextGameTimer = null;
                this._gameId = null;
            } else {
                inning = String(parsed.game.outcome[0].$.current_inning_half) + String(parsed.game.outcome[0].$.current_inning);
                this._nextGameTimer = setTimeout(this._onNextGameEvent.bind(this), 5*60000); // poll in 5 minutes
            }

            // remember current status - only report each time the inning changes
            if (inning === this._inning) {
                return;
            } else {
                this._inning = inning;
            }

            var awayRuns = Number(parsed.game.away[0].$.runs);
            var homeRuns = Number(parsed.game.home[0].$.runs);

            this._emit(parsed.game.$.status, inning, awayRuns, homeRuns);
        }.bind(this)).catch(function(e) {
            console.error('Failed to process MLB game updates: ' + e.message);
            console.error(e.stack);
        }).done();
    },

    _onTick: function() {
        this._updateUrl();
        return this.parent();
    },

    _onResponse: function(response) {
        if(!response) {
            return;
        }

        Tp.Helpers.Xml.parseString(response).then((parsed) => {
            var games = parsed.league['daily-schedule'][0].games[0].game;
            var game = null;
            for (var i = 0; i < games.length; i++) {
                if (games[i].$.status === 'closed') {
                    continue;
                }

                if (games[i].home[0].$.abbr === this._observedTeam ||
                    games[i].away[0].$.abbr === this._observedTeam ) {
                    game = games[i];
                    break;
                }
            }
            if (game === null) {
                console.log('No scheduled games found for ' + this._observedTeam);
                clearTimeout(this._nextGameTimer);
                this._nextGameTimer = null;
                this._gameId = null;
                return;
            }

            if (this._gameId === game.$.id) {
                // we've already seen this game
                return;
            }

            console.log('Found game ' + game.$.id + ': ' + game.home[0].$.abbr + ' vs. ' + game.away[0].$.abbr);
            this._gameId = game.$.id;
            this._awayAlias = game.away[0].abbr;
            this._awayName = game.away[0].market + ' ' + game.away[0].name;
            this._homeAlias = game.home[0].abbr;
            this._homeName = game.home[0].market + ' ' + game.home[0].name;

            var timeout;
            if (game.$.status === 'scheduled') {
                var scheduled = new Date(game.$.scheduled);
                this._scheduledTime = scheduled;
                var now = new Date();
                timeout = scheduled.getTime - now.getTime() + 5000;
                if (timeout >= 5000) {
                    this._emit('scheduled', 'Pre', 0, 0);
                } else {
                    timeout = 5000;
                }

                if (timeout > POLL_INTERVAL) {
                    clearTimeout(this._nextGameTimer);
                    return;
                }
            } else {
                this._scheduleTime = new Date();
                timeout = 5000;
            }

            clearTimeout(this._nextGameTimer);
            this._nextGameTimer = setTimeout(this._onNextGameEvent.bind(this), timeout);
        }).catch((error) => {
            console.error('Failed to process MLB game schedule: ' + error.message);
            console.error(error.stack);
        });
    },
});
