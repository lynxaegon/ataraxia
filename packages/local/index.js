'use strict';

const os = require('os');
const path = require('path');

const { LowLevelNetwork } = require('local-machine-network');
const { AbstractTransport, Peer, addPeer, events } = require('ataraxia/transport');

const eos = require('end-of-stream');

/**
 * Machine local transport. Uses Unix sockets to connect to peers on the
 * same machine.
 */
module.exports = class MachineLocal extends AbstractTransport {
	constructor() {
		super('local');

		this.leader = false;
	}

	start(options) {
		// Call super.start() and return if already started
		if(! super.start(options)) return false;

		const id = path.join(os.tmpdir(), options.name + '');

		this.net = new LowLevelNetwork({
			path: id
		});
		this.net.on('leader', serverSocket => {
			// Emit an event when this node becomes the leader
			eos(serverSocket, err => {
				if(err) {
					this.debug('Closed with error;', err);
				}
			});

			this.debug('This node is now the leader of the machine local network');
			this[events].emit('leader');
		});

		const handlePeer = sock => {
			const peer = new LocalPeer(this);
			peer.setSocket(sock);
			peer.negotiate();
			this[addPeer](peer);
		};

		this.net.on('connection', handlePeer);
		this.net.on('connected', handlePeer);

		this.net.connect()
			.catch(this.debug);

		return true;
	}

	stop() {
		if(this.started) {
			this.net.close();
		}

		return super.stop();
	}
};


class LocalPeer extends Peer {
	disconnect() {
		// Disconnect does nothing for local transport
		this.handleDisconnect();
	}
}
