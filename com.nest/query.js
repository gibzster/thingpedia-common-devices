// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

module.exports = function(name, invokeQuery) {
    return new Tp.ChannelClass({
        Name: 'Nest' + name + 'Channel',

        _init: function(engine, device) {
            this.parent();
            this.device = device;
            this.master = device.master;
        },

        _doOpen: function() {
            this._firebase = this.master.refFirebaseClient().child(this.device.url);
        },

        _doClose: function() {
            this.master.unrefFirebaseClient();
            this._firebase = null;
        },

        invokeQuery: function(event) {
            return invokeQuery.call(this, this.device.state, event);
        }
    });
};