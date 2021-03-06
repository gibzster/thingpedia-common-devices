// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details

const Source = require('./source');

module.exports = Source('sleeps', 'sleep', function(event) {
    return [event.time_updated * 1000, { x: event.place_lon, y: event.place_lat },
            event.details.awake_time * 1000, event.details.asleep_time * 1000,
            event.details.duration * 1000,
            event.details.rem * 1000, event.details.light * 1000,
            event.details.deep * 1000];
});
