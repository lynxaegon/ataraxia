'use strict';

const debug = require('debug')
const { EventEmitter } = require('events');
const FailureDetector = require('adaptive-accrual-failure-detector');

const CURRENT_VERSION = 2;
const pingInterval = 5000;
const pingCheckInterval = 1000;

/**
 * Peer as found by a transport. Peers represent a connection between the
 * local transport instance and another transprt instance. Peers can be remote
 * computers, within the same VM or machine local.
 *
 * This class can be extended by transports as needed.
 *
 * The following events are available on a peer:
 *
 * * `connected` - emitted when the peer is connected
 * * `disconnected` - emitted when the peer is disconnected
 * * `message` - when a message is received from the peer
 * * `ping` - Internal use - when a ping is received from the peer
 * * `hello` - Internal use - when initial negotiation is done
 *
 */
module.exports = class Peer {

	/**
	 * Create a new peer over the given transport.
	 *
	 * @param {AbstractTransport} transport
	 */
	constructor(transport) {
		this.networkId = transport.networkId;
		const ns = transport.debug ? transport.debug.namespace + ':peer' : 'ataraxia:peer';
		this.debug = debug(ns);
		this.events = new EventEmitter();
		this.connected = false;

		this.failureDetector = new FailureDetector();

		// Reply to hello messages with our metadata
		this.events.on('hello', msg => {
			// Set the identifier and the version of the protocol to use
			this.id = msg.id;
			this.version = Math.min(msg.version, CURRENT_VERSION);

			// Update debugging with the identifier of the peer
			this.debug = debug(ns + ':' + msg.id);

			// Clear the timeout that decides when a peer fails negotiation
			if(this.helloTimeout) {
				clearTimeout(this.helloTimeout);
				this.helloTimeout = null;
			}

			if(this.version >= 2) {
				// V2+ of protocol - setup a ping every 5 seconds
				this.pingSender = setInterval(() => this.write('ping'), pingInterval);
				this.pingChecker = setInterval(() => this.checkFailure(), pingCheckInterval);

				this.write('ping');
			} else {
				// V1 of protocol - assume we are connected when hello is received
				this.events.emit('connected');
			}
		});

		// Handle pings
		this.on('ping', () => {
			if(! this.connected && this.version) {
				// Consider the peer connected
				this.connected = true;
				this.events.emit('connected');
			}

			this.failureDetector.registerHeartbeat();
		});
	}

	/**
	 * Handle disconnect event. This implementation will log info about the
	 * disconnect and then mark the peer as disconnected.
	 *
	 * Transports may override this to provide reconnection behavior.
	 */
	handleDisconnect(err) {
		if(typeof err !== 'undefined') {
			this.debug('Disconnected via an error:', err);
		} else {
			this.debug('Disconnected gracefully');
		}

		clearTimeout(this.helloTimeout);

		clearInterval(this.pingSender);
		clearInterval(this.pingChecker);

		this.connected = false;
		this.events.emit('disconnected');
	}

	/**
	 * Negotiate with this peer to retrieve information about it. Will send a
	 * hello message with our network id and the maximum version we can handle.
	 */
	negotiate() {
		// Write the hello message
		this.write('hello', {
			id: this.networkId,
			version: CURRENT_VERSION
		});

		// Wait a few seconds for the hello from the other side
		if(this.helloTimeout) {
			clearTimeout(this.helloTimeout);
		}
		this.helloTimeout = setTimeout(
			() => this.requestDisconnect(new Error('Time out during negotiation')),
			5000
		);
	}

	/**
	 * Check if this peer can be considered failed and request us to be
	 * disconnected from it.
	 */
	checkFailure() {
		if(this.failureDetector.checkFailure()) {
			this.requestDisconnect();
		}
	}

	/**
	 * Register an event handler.
	 */
	on(event, handler) {
		this.events.on(event, handler);
	}

	/**
	 * Manually disconnect this peer.
	 */
	disconnect() {
		this.debug('Requesting disconnect from peer');
	}

	requestDisconnect(err) {
	}

	/**
	 * Send a message to this peer.
	 */
	send(payload) {
		this.write('message', payload);
	}

	/**
	 * Write data to the peer, used internally to send data associated with a
	 * specific type.
	 *
	 * @param {string} type
	 * @param {*} payload
	 */
	write(type, payload) {
		throw new Error('write(type, payload) must be implemented');
	}
};
