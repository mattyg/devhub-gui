const { Logger }			= require('@whi/weblogger');
const log				= new Logger("store");

const { HoloHash,
	AgentPubKey }			= holohash;
const { EntityArchitect }		= CruxPayloadParser;
const { Entity, Collection }		= EntityArchitect;


// Data getting scenarios:
//
//   1. Get metadata based on ID
//      - loaded	- true if this entity has ever been loaded
//      - loading	- true if the corresponding "fetch..." method has been dispatched but has not finished
//      - current	- true if 'loaded' is true and not expired
//      - writable	- true if the current agent can commit updates to this entity
//      - stored_at	- used to calculate expiry date
//   2. Get (current) cached info for entity based on ID
//   3. Get (any) cached info for entity based on ID
//   4. Must get entity based on ID
//      - Is it in cache?
//      - Is it expired?
//      - Is it in Holochain?
//
// Vuex solutions:
//
//   state	- (sync) get raw data
//   getters	- (sync) get processed data
//   actions	- (async) exectue a process that can commit mutations
//
// Scenario to Vuex solution map:
//
//   1. (getters) so that there can be a default state for any metadata ID
//   2. (getters) so that the expiry date can be calculated and checked
//   3. (getters) so that it returns 'null' as the default instead of 'undefined'
//   4. (actions) so that async is supported



const DEFAULT_METADATA_STATES		= {
    "loaded": false,
    "loading": false,
    "current": false,
    "writable": false,
    "stored_at": Infinity,
};
const CACHE_EXPIRATION_LIMIT		= 1_000 * 60 * 10; // 10 minutes
const copy				= obj => Object.assign( {}, obj );
const store_path			= ( ...segments ) => segments.join("/");

const dataTypePath			= {
    zomes:		( agent )	=> store_path( "zomes", agent ),
    zome:		( id )		=> store_path( "zome", id ),
    zomeVersions:	( id )		=> store_path( "zome", id, "versions" ),
    zomeVersion:	( id )		=> store_path( "zome", "version", id ),

    dnas:		( agent )	=> store_path( "dnas", agent ),
    dna:		( id )		=> store_path( "dna", id ),
    dnaVersions:	( id )		=> store_path( "dna", id, "versions" ),
    dnaVersion:		( id )		=> store_path( "dna", "version", id ),

    happs:		( agent )	=> store_path( "happs", agent ),
    happ:		( id )		=> store_path( "happ", id ),
    happReleases:	( id )		=> store_path( "happ", id, "releases" ),
    happRelease:	( id )		=> store_path( "happ", "release", id ),

    zomeVersionWasm:	( addr )	=> store_path( "zome", "version", addr, "wasm_bytes" ),
    dnaVersionPackage:	( addr )	=> store_path( "dna",  "version", addr, "package_bytes" ),
    happReleasePackage:	( addr )	=> store_path( "happ", "release", addr, "package_bytes" ),

    hdkVersions:	()		=> store_path( "misc", "hdk_versions" ),
    webAsset:		( id )		=> store_path( "web_assets", id ),
};


function hashesAreEqual ( hash1, hash2 ) {
    if ( hash1 instanceof Uint8Array )
	hash1		= new HoloHash( hash1 )
    if ( hash1 instanceof HoloHash )
	hash1		= hash1.toString();

    if ( hash2 instanceof Uint8Array )
	hash2		= new HoloHash( hash2 )
    if ( hash2 instanceof HoloHash )
	hash2		= hash2.toString();

    if ( typeof hash1 !== "string" )
	throw new TypeError(`Invalid first argument; expected string or Uint8Array; not type of ${typeof hash1}`);

    if ( typeof hash2 !== "string" )
	throw new TypeError(`Invalid second argument; expected string or Uint8Array; not type of ${typeof hash2}`);

    return hash1 === hash2;
}

function fmt_client_args ( dna, zome, func, args ) {
    if ( String(args) === "[object Object]" && Object.keys(args).length )
	return `${dna}::${zome}->${func}( ${Object.keys(args).join(", ")} )`;
    else
	return `${dna}::${zome}->${func}()`;
}


module.exports = async function ( client ) {
    return new Vuex.Store({
	state () {
	    return {
		client,
		"entities": {},
		"collections": {},
		"metadata": {},
	    };
	},
	"getters": {
	    isExpired: ( _, getters ) => ( path ) => {
		return getters.metadata( path ).stored_at + CACHE_EXPIRATION_LIMIT < Date.now();
	    },
	    entity: ( state, getters ) => ( path ) => {
		if ( getters.isExpired( path ) )
		    return null;

		return state.entities[ path ] || null;
	    },
	    collection: ( state, getters ) => ( path ) => {
		if ( getters.isExpired( path ) )
		    return [];

		return state.collections[ path ] || [];
	    },
	    metadata: ( state, getters ) => ( path ) => {
		return state.metadata[ path ] || copy( DEFAULT_METADATA_STATES );
	    },

	    //
	    // Agent
	    //
	    agent: ( _, getters ) => {
		const path		= "me";
		return {
		    "entity":		getters.entity( path ),
		    "metadata":		getters.metadata( path ),
		};
	    },

	    //
	    // Zome
	    //
	    zomes: ( _, getters ) => ( agent = "me" ) => {
		const path		= dataTypePath.zomes( agent );
		return getters.collection( path );
	    },
	    $zomes: ( _, getters ) => ( agent = "me" ) => {
		const path		= dataTypePath.zomes( agent );
		return getters.metadata( path );
	    },

	    zome: ( _, getters ) => ( id ) => {
		const path		= dataTypePath.zome( id );
		return getters.entity( path );
	    },
	    $zome: ( _, getters ) => ( id ) => {
		const path		= dataTypePath.zome( id );
		return getters.metadata( path );
	    },

	    zome_versions: ( _, getters ) => ( zome_id ) =>  {
		const path		= dataTypePath.zomeVersions( zome_id );
		return getters.collection( path );
	    },
	    $zome_versions: ( _, getters ) => ( zome_id ) => {
		const path		= dataTypePath.zomeVersions( zome_id );
		return getters.metadata( path );
	    },

	    zome_version: ( _, getters ) => ( id ) =>  {
		const path		= dataTypePath.zomeVersion( id );
		return getters.entity( path );
	    },
	    $zome_version: ( _, getters ) => ( id ) => {
		const path		= dataTypePath.zomeVersion( id );
		return getters.metadata( path );
	    },

	    // zome_version_wasm: ( _, getters ) => ( addr ) =>  {
	    // 	const path		= dataTypePath.zomeVersionWasm( addr );
	    // 	return getters.entity( path );
	    // },
	    $zome_version_wasm: ( _, getters ) => ( agent = "me" ) => {
		const path		= dataTypePath.zomeVersionWasm( addr );
		return getters.metadata( path );
	    },

	    //
	    // DNA
	    //
	    dnas: ( _, getters ) => ( agent = "me" ) => {
		const path		= dataTypePath.dnas( agent );
		return getters.collection( path );
	    },
	    $dnas: ( _, getters ) => ( agent = "me" ) => {
		const path		= dataTypePath.dnas( agent );
		return getters.metadata( path );
	    },

	    dna: ( _, getters ) => ( id ) => {
		const path		= dataTypePath.dna( id );
		return getters.entity( path );
	    },
	    $dna: ( _, getters ) => ( id ) => {
		const path		= dataTypePath.dna( id );
		return getters.metadata( path );
	    },

	    dna_versions: ( _, getters ) => ( dna_id ) =>  {
		const path		= dataTypePath.dnaVersions( dna_id );
		return getters.collection( path );
	    },
	    $dna_versions: ( _, getters ) => ( dna_id ) =>  {
		const path		= dataTypePath.dnaVersions( dna_id );
		return getters.metadata( path );
	    },

	    dna_version: ( _, getters ) => ( id ) =>  {
		const path		= dataTypePath.dnaVersion( id );
		return getters.entity( path );
	    },
	    $dna_version: ( _, getters ) => ( id ) =>  {
		const path		= dataTypePath.dnaVersion( id );
		return getters.metadata( path );
	    },

	    $dna_version_package: ( _, getters ) => ( addr ) =>  {
		const path		= dataTypePath.dnaVersionPackage( addr );
		return getters.metadata( path );
	    },

	    //
	    // hApp
	    //
	    happs: ( _, getters ) => ( agent = "me" ) => {
		const path		= dataTypePath.happs( agent );
		return getters.collection( path );
	    },
	    $happs: ( _, getters ) => ( agent = "me" ) => {
		const path		= dataTypePath.happs( agent );
		return getters.metadata( path );
	    },

	    happ: ( _, getters ) => ( id ) => {
		const path		= dataTypePath.happ( id );
		return getters.entity( path );
	    },
	    $happ: ( _, getters ) => ( id ) => {
		const path		= dataTypePath.happ( id );
		return getters.metadata( path );
	    },

	    happ_releases: ( _, getters ) => ( happ_id ) =>  {
		const path		= dataTypePath.happReleases( happ_id );
		return getters.collection( path );
	    },
	    $happ_releases: ( _, getters ) => ( happ_id ) =>  {
		const path		= dataTypePath.happReleases( happ_id );
		return getters.metadata( path );
	    },

	    happ_release: ( _, getters ) => ( id ) =>  {
		const path		= dataTypePath.happRelease( id );
		return getters.entity( path );
	    },
	    $happ_release: ( _, getters ) => ( id ) =>  {
		const path		= dataTypePath.happRelease( id );
		return getters.metadata( path );
	    },

	    // happ_release_package: ( _, getters ) => ( addr ) =>  {
	    // 	const path		= dataTypePath.happReleasePackage( addr );
	    // 	return getters.entity( path );
	    // },
	    $happ_release_package: ( _, getters ) => ( addr ) =>  {
		const path		= dataTypePath.happReleasePackage( addr );
		return getters.metadata( path );
	    },

	    //
	    // Miscellaneous
	    //
	    hdk_versions: ( _, getters ) => {
		const path		= dataTypePath.hdkVersions();
		return getters.collection( path );
	    },
	    $hdk_versions: ( _, getters ) => {
		const path		= dataTypePath.hdkVersions();
		return getters.metadata( path );
	    },
	},
	"mutations": {
	    expireEntity ( state, path ) {
		if ( state.metadata[path] === undefined )
		    state.metadata[path]	= copy( DEFAULT_METADATA_STATES );

		state.metadata[path].stored_at	= -Infinity;
		state.metadata[path].current	= false;
	    },
	    cacheEntity ( state, [ path, entity ] ) {
		state.entities[path]		= entity;

		if ( state.metadata[path] === undefined )
		    state.metadata[path]	= copy( DEFAULT_METADATA_STATES );

		state.metadata[path].stored_at	= Date.now();
		state.metadata[path].loaded	= true;
		state.metadata[path].current	= true;
	    },
	    cacheCollection ( state, [ path, collection ]) {
		state.collections[path]		= collection;

		if ( state.metadata[path] === undefined )
		    state.metadata[path]	= copy( DEFAULT_METADATA_STATES );

		state.metadata[path].stored_at	= Date.now();
		state.metadata[path].loaded	= true;
		state.metadata[path].current	= true;
	    },
	    metadata ( state, [ path, metadata ] ) {
		if ( state.metadata[path] === undefined )
		    state.metadata[path]	= copy( DEFAULT_METADATA_STATES );

		const entity		= state.metadata[path];
		for ( let k in metadata ) {
		    entity[k]		= metadata[k];
		}
	    },
	    signalLoading ( state, path ) {
		if ( state.metadata[path] === undefined )
		    state.metadata[path]	= copy( DEFAULT_METADATA_STATES );

		state.metadata[path].loading	= true;
		state.metadata[path].current	= false;
	    },
	    recordLoaded ( state, path ) {
		if ( state.metadata[path] === undefined )
		    state.metadata[path]	= copy( DEFAULT_METADATA_STATES );

		state.metadata[path].loaded	= true;
		state.metadata[path].loading	= false;
		state.metadata[path].current	= true;
	    },
	},
	"actions": {
	    async callClient ( ctx, [ dna, zome, func, args, timeout ]) {
		log.debug("Getting dna %s", () => [
		    fmt_client_args( dna, zome, func, args ) ]);
		try {
		    const resp		= await client.call( dna, zome, func, args, timeout );
		    log.trace("Received response:", resp );

		    return resp;
		} catch (err) {
		    log.error("Client call raised: %s( %s )", err.name, err.message );

		    throw err;
		}
	    },
	    async fetchResource ({ dispatch, commit }, [ path, dna, zome, func, args, timeout ]) {
		commit("signalLoading", path );

		const resource		= await dispatch("callClient", [ dna, zome, func, args, timeout ]);

		// Should use a different cache because resources are not required to be instance of Entity
		commit("cacheEntity", [ path, resource ] );
		commit("recordLoaded", path );

		return resource;
	    },
	    async fetchEntity ({ dispatch, commit }, [ path, dna, zome, func, args, timeout ]) {
		commit("signalLoading", path );

		const entity		= await dispatch("callClient", [ dna, zome, func, args, timeout ]);

		if ( entity.constructor.name !== "Entity" )
		    log.warn("Expected instance of Entity for request %s; received type '%s'", fmt_client_args( dna, zome, func, args ), typeof entity );

		commit("cacheEntity", [ path, entity ] );
		commit("recordLoaded", path );

		return entity;
	    },
	    async fetchCollection ({ dispatch, commit }, [ path, dna, zome, func, args, timeout ]) {
		commit("signalLoading", path );

		const collection	= await dispatch("callClient", [ dna, zome, func, args, timeout ]);

		if ( collection.constructor.name !== "Collection" )
		    log.warn("Expected instance of Collection for request %s; received type '%s'", fmt_client_args( dna, zome, func, args ), typeof collection );

		commit("cacheCollection", [ path, collection ] );
		commit("recordLoaded", path );

		return collection;
	    },
	    expireEntity ({ commit }, [ path_fn_name, id ] ) {
		const path		= dataTypePath[ path_fn_name ]( id );

		commit("expireEntity", path );
	    },

	    // Create
	    async createEntity ({ dispatch, commit }, [ path_fn, dna, zome, func, args, timeout ]) {
		const entity		= await dispatch("callClient", [ dna, zome, func, args, timeout ]);
		log.debug("Created Entity with ID: %s", String(entity.$id) );
		const path		= path_fn( entity.$id );

		commit("cacheEntity", [ path, entity ] );
		commit("metadata", [ path, { "writable": true }] );

		return entity;
	    },
	    // Update
	    async updateEntity ({ dispatch, commit }, [ path, dna, zome, func, args, timeout ]) {
		commit("metadata", [ path, { "updating": true }] );

		try {
		    // log.normal("Updating Zome (%s)", String(entity.$addr) );
		    const entity	= await dispatch("callClient", [ dna, zome, func, args, timeout ]);

		    commit("cacheEntity", [ path, entity ] );

		    return entity;
		} finally {
		    commit("metadata", [ path, { "updating": false }] );
		}
	    },
	    // Unpublish
	    async unpublishEntity ({ dispatch, commit }, [ path, dna, zome, func, args, timeout ]) {
		commit("metadata", [ path, { "unpublishing": true }] );

		try {
		    // log.normal("Deleting Zome Version (%s)", String(id) );
		    await dispatch("callClient", [ dna, zome, func, args, timeout ]);

		    commit("expireEntity", path );
		} finally {
		    commit("metadata", [ path, { "unpublishing": false }] );
		}
	    },
	    // Unpublish
	    async deprecateEntity ({ dispatch, commit }, [ path, dna, zome, func, args, timeout ]) {
		commit("metadata", [ path, { "deprecating": true }] );

		try {
		    // log.normal("Deprecating DNA (%s) because: %s", String(entity.$addr), message );
		    const entity	= await dispatch("callClient", [ dna, zome, func, args, timeout ]);

		    commit("cacheEntity", [ path, entity ] );

		    return entity;
		} finally {
		    commit("metadata", [ path, { "deprecating": false }] );
		}
	    },

	    //
	    // Agent
	    //
	    async getAgent ({ getters, dispatch }) {
		if ( getters.agent.entity )
		    return getters.agent.entity;
		else
		    return await dispatch("fetchAgent");
	    },

	    async fetchAgent ({ dispatch, commit }) {
		const path		= "me";

		commit("signalLoading", path );

		log.debug("Getting agent info (whoami)");
		const info		= await dispatch("callClient", [
		    "dnarepo", "dna_library", "whoami"
		]);

		const resp		= {
		    "pubkey": {
			"initial": new AgentPubKey( info.agent_initial_pubkey ),
			"current": new AgentPubKey( info.agent_latest_pubkey ),
		    },
		};

		commit("cacheEntity", [ path, resp ] );
		commit("recordLoaded", path );

		return resp;
	    },

	    async fetchZomes ({ dispatch }, { agent } ) {
		const path		= dataTypePath.zomes( agent );
		const args		= [ "dnarepo", "dna_library" ];

		if ( agent === "me" )
		    args.push( "get_my_zomes" );
		else
		    args.push( "get_zomes", { agent } );

		const zomes		= await dispatch("fetchCollection", [
		    path, ...args
		]);

		return zomes;
	    },

	    async fetchDnas ({ dispatch }, { agent } ) {
		const path		= dataTypePath.dnas( agent );
		const args		= [ "dnarepo", "dna_library" ];

		if ( agent === "me" )
		    args.push( "get_my_dnas" );
		else
		    args.push( "get_dnas", { agent } );

		const dnas		= await dispatch("fetchCollection", [
		    path, ...args
		]);

		return dnas;
	    },

	    async fetchHapps ({ dispatch }, { agent } ) {
		const path		= dataTypePath.happs( agent );
		const args		= [ "happs", "happ_library" ];

		if ( agent === "me" )
		    args.push( "get_my_happs" );
		else
		    args.push( "get_happs", { agent } );

		const happs		= await dispatch("fetchCollection", [
		    path, ...args
		]);

		return happs;
	    },


	    //
	    // Zome
	    //
	    async fetchZome ({ dispatch, commit }, id ) {
		const path		= dataTypePath.zome( id );
		const zome		= await dispatch("fetchEntity", [
		    path, "dnarepo", "dna_library", "get_zome", { id }
		]);

		let agent_info		= await dispatch("getAgent");

		commit("metadata", [ path, {
		    "writable": hashesAreEqual( zome.developer.pubkey, agent_info.pubkey.initial ),
		}] );

		return zome;
	    },

	    async fetchVersionsForZome ({ dispatch }, zome_id ) {
		const path		= dataTypePath.zomeVersions( zome_id );

		return await dispatch("fetchCollection", [
		    path, "dnarepo", "dna_library", "get_zome_versions", { "for_zome": zome_id }
		]);
	    },

	    async createZome ({ dispatch }, input ) {
		log.normal("Creating Zome: %s", input.name );
		return await dispatch("createEntity", [
		    dataTypePath.zome, "dnarepo", "dna_library", "create_zome", input
		]);
	    },

	    async updateZome ({ dispatch, getters }, [ id, input ] ) {
		const entity		= getters.zome( id ).entity;
		const path		= dataTypePath.zome( id );

		log.normal("Updating Zome (%s)", String(entity.$addr) );
		return await dispatch("updateEntity", [
		    path, "dnarepo", "dna_library", "update_zome", {
			"addr": entity.$addr,
			"properties": input,
		    }
		]);
	    },

	    async deprecateZome ({ dispatch, getters }, [ id, { message } ] ) {
		const entity		= getters.zome( id ).entity;
		const path		= dataTypePath.zome( id );

		log.normal("Deprecating Zome (%s) because: %s", String(entity.$addr), message );
		return await dispatch("deprecateEntity", [
		    path, "dnarepo", "dna_library", "deprecate_zome", {
			"addr": entity.$addr,
			"message": message,
		    }
		]);
	    },

	    async fetchAllZomes ({ dispatch }) {
		const path		= dataTypePath.zomes( "all" );

		return await dispatch("fetchCollection", [
		    path, "dnarepo", "dna_library", "get_all_zomes"
		]);
	    },


	    //
	    // Zome Version
	    //
	    async fetchZomeVersion ({ dispatch, commit }, id ) {
		const path		= dataTypePath.zomeVersion( id );
		const version		= await dispatch("fetchEntity", [
		    path, "dnarepo", "dna_library", "get_zome_version", { id }
		]);

		let agent_info		= await dispatch("getAgent");

		commit("metadata", [ path, {
		    "writable": hashesAreEqual( version.for_zome.developer.pubkey, agent_info.pubkey.initial ),
		}] );

		return version;
	    },

	    async fetchZomeVersionWasm ({ dispatch, commit }, addr ) {
		const path		= dataTypePath.zomeVersionWasm( addr );

		commit("signalLoading", path );

		log.debug("Getting agent info (whoami)");
		const result		= await dispatch("callClient", [
		    "dnarepo", "mere_memory", "retrieve_bytes", addr
		]);
		const wasm_bytes	= new Uint8Array( result );

		commit("cacheEntity", [ path, wasm_bytes ] );
		commit("recordLoaded", path );

		return wasm_bytes;
	    },

	    async createZomeVersion ({ dispatch }, [ zome_id, input ] ) {
		input.for_zome		= zome_id;

		log.normal("Creating Zome Version: #%s", input.version );
		return await dispatch("createEntity", [
		    dataTypePath.zomeVersion, "dnarepo", "dna_library", "create_zome_version", input
		]);
	    },

	    async updateZomeVersion ({ dispatch, getters }, [ id, input ] ) {
		const entity		= getters.zome_version( id ).entity;
		const path		= dataTypePath.zomeVersion( id );

		log.normal("Updating Zome Version (%s)", String(entity.$addr) );
		return await dispatch("updateEntity", [
		    path, "dnarepo", "dna_library", "update_zome_version", {
			"addr": entity.$addr,
			"properties": input,
		    }
		]);
	    },

	    async unpublishZomeVersion ({ dispatch }, id ) {
		const path		= dataTypePath.zomeVersion( id );

		log.normal("Deleting Zome Version (%s)", String(id) );
		return await dispatch("unpublishEntity", [
		    path, "dnarepo", "dna_library", "delete_zome_version", { id }
		]);
	    },


	    //
	    // DNA
	    //
	    async fetchDna ({ dispatch, commit }, id ) {
		const path		= dataTypePath.dna( id );
		const dna		= await dispatch("fetchEntity", [
		    path, "dnarepo", "dna_library", "get_dna", { id }
		]);

		let agent_info		= await dispatch("getAgent");

		commit("metadata", [ path, {
		    "writable": hashesAreEqual( dna.developer.pubkey, agent_info.pubkey.initial ),
		}] );

		return dna;
	    },

	    async fetchVersionsForDna ({ dispatch }, dna_id ) {
		const path		= dataTypePath.dnaVersions( dna_id );

		return await dispatch("fetchCollection", [
		    path, "dnarepo", "dna_library", "get_dna_versions", { "for_dna": dna_id }
		]);
	    },

	    async createDna ({ dispatch }, input ) {
		log.normal("Creating DNA: %s", input.name );
		return await dispatch("createEntity", [
		    dataTypePath.dna, "dnarepo", "dna_library", "create_dna", input
		]);
	    },

	    async updateDna ({ dispatch, getters }, [ id, input ] ) {
		const entity		= getters.dna( id ).entity;
		const path		= dataTypePath.dna( id );

		log.normal("Updating DNA (%s)", String(entity.$addr) );
		return await dispatch("updateEntity", [
		    path, "dnarepo", "dna_library", "update_dna", {
			"addr": entity.$addr,
			"properties": input,
		    }
		]);
	    },

	    async deprecateDna ({ dispatch, getters }, [ id, { message } ] ) {
		const entity		= getters.dna( id ).entity;
		const path		= dataTypePath.dna( id );

		log.normal("Deprecating DNA (%s) because: %s", String(entity.$addr), message );
		return await dispatch("deprecateEntity", [
		    path, "dnarepo", "dna_library", "deprecate_dna", {
			"addr": entity.$addr,
			"message": message,
		    }
		]);
	    },

	    async fetchAllDnas ({ dispatch }) {
		const path		= dataTypePath.dnas( "all" );

		return await dispatch("fetchCollection", [
		    path, "dnarepo", "dna_library", "get_all_dnas"
		]);
	    },


	    //
	    // DNA Version
	    //
	    async fetchDnaVersion ({ dispatch, commit }, id ) {
		const path		= dataTypePath.dnaVersion( id );

		const version		= await dispatch("fetchEntity", [
		    path, "dnarepo", "dna_library", "get_dna_version", { id }
		]);

		let agent_info		= await dispatch("getAgent");

		commit("metadata", [ path, {
		    "writable": hashesAreEqual( version.for_dna.developer.pubkey, agent_info.pubkey.initial ),
		}] );

		return version;
	    },

	    async fetchDnaVersionPackage ({ dispatch, commit }, id ) {
		const path		= dataTypePath.dnaVersionPackage( id );

		commit("signalLoading", path );

		log.debug("Getting DNA package %s", String(id) );
		const pack		= await dispatch("callClient", [
		    "dnarepo", "dna_library", "get_dna_package", { id }
		]);

		const wasm_bytes	= new Uint8Array( result );

		commit("cacheEntity", [ path, wasm_bytes ] );
		commit("recordLoaded", path );

		return pack;
	    },

	    async createDnaVersion ({ dispatch }, [ dna_id, input ] ) {
		input.for_dna		= dna_id;

		log.normal("Creating DNA Version: #%s", input.version );
		return await dispatch("createEntity", [
		    dataTypePath.dnaVersion, "dnarepo", "dna_library", "create_dna_version", input
		]);
	    },

	    async updateDnaVersion ({ dispatch, getters }, [ id, input ] ) {
		const entity		= getters.dna_version( id ).entity;
		const path		= dataTypePath.dnaVersion( id );

		log.normal("Updating DNA Version (%s)", String(entity.$addr) );
		return await dispatch("updateEntity", [
		    path, "dnarepo", "dna_library", "update_dna_version", {
			"addr": entity.$addr,
			"properties": input,
		    }
		]);
	    },

	    async unpublishDnaVersion ({ dispatch }, id ) {
		const path		= dataTypePath.dnaVersion( id );

		log.normal("Deleting DNA Version (%s)", String(id) );
		return await dispatch("unpublishEntity", [
		    path, "dnarepo", "dna_library", "delete_dna_version", { id }
		]);
	    },


	    //
	    // Happ
	    //
	    async fetchHapp ({ dispatch, commit }, id ) {
		const path		= dataTypePath.happ( id );

		log.debug("Getting happ %s", String(id) );
		const happ		= await dispatch("fetchEntity", [
		    path, "happs", "happ_library", "get_happ", { id }
		]);

		let agent_info		= await dispatch("getAgent");

		commit("metadata", [ path, {
		    "writable": hashesAreEqual( happ.designer, agent_info.pubkey.initial ),
		}] );

		return happ;
	    },

	    async fetchReleasesForHapp ({ dispatch }, happ_id ) {
		const path		= dataTypePath.happReleases( happ_id );

		return await dispatch("fetchCollection", [
		    path, "happs", "happ_library", "get_happ_releases", { "for_happ": happ_id }
		]);
	    },

	    async createHapp ({ dispatch }, input ) {
		log.normal("Creating Happ: %s", input.title );
		return await dispatch("createEntity", [
		    dataTypePath.happ, "happs", "happ_library", "create_happ", input
		]);
	    },

	    async updateHapp ({ dispatch, getters }, [ id, input ] ) {
		const entity		= getters.happ( id ).entity;
		const path		= dataTypePath.happ( id );

		log.normal("Updating Happ (%s)", String(entity.$addr) );
		return await dispatch("updateEntity", [
		    path, "happs", "happ_library", "update_happ", {
			"addr": entity.$addr,
			"properties": input,
		    }
		]);
	    },

	    async deprecateHapp ({ dispatch, getters }, [ id, { message } ] ) {
		const entity		= getters.happ( id ).entity;
		const path		= dataTypePath.happ( id );

		log.normal("Deprecating Happ (%s) because: %s", String(entity.$addr), message );
		return await dispatch("deprecateEntity", [
		    path, "happs", "happ_library", "deprecate_happ", {
			"addr": entity.$addr,
			"message": message,
		    }
		]);
	    },

	    async fetchAllHapps ({ dispatch }) {
		const path		= dataTypePath.happs( "all" );

		return await dispatch("fetchCollection", [
		    path, "happs", "happ_library", "get_all_happs"
		]);
	    },


	    //
	    // Happ Release
	    //
	    async fetchHappRelease ({ dispatch, commit }, id ) {
		const path		= dataTypePath.happRelease( id );

		log.debug("Getting happ release %s", String(id) );
		const release		= await dispatch("fetchEntity", [
		    path, "happs", "happ_library", "get_happ_release", { id }
		]);

		let agent_info		= await dispatch("getAgent");

		commit("metadata", [ path, {
		    "writable": hashesAreEqual( release.for_happ.designer, agent_info.pubkey.initial ),
		}] );

		return release;
	    },

	    async fetchHappReleasePackage ({ dispatch, commit }, id ) {
		const path		= dataTypePath.happReleasePackage( id );

		commit("signalLoading", path );

		log.debug("Getting hApp package %s", String(id) );
		const result		= await dispatch("callClient", [
		    "happs", "happ_library", "get_release_package", { id }, 30_000
		]);

		const wasm_bytes	= new Uint8Array( result );

		commit("cacheEntity", [ path, wasm_bytes ] );
		commit("recordLoaded", path );

		return bytes;
	    },

	    async fetchWebhappReleasePackage ({ dispatch, commit }, { name, id } ) {
		const path		= dataTypePath.happReleasePackage( id + "-webhapp" );

		commit("signalLoading", path );

		log.debug("Getting hApp package %s", String(id) );
		const result			= await dispatch("callClient", [
		    "happs", "happ_library", "get_webhapp_package", { name, id }, 30_000
		]);

		const wasm_bytes	= new Uint8Array( result );

		commit("cacheEntity", [ path, bytes ] );
		commit("recordLoaded", path );

		return bytes;
	    },

	    async createHappRelease ({ dispatch }, [ happ_id, input ] ) {
		input.for_happ		= happ_id;

		log.normal("Creating hApp Release for hApp (%s): %s", String(happ_id), input.name );
		return await dispatch("createEntity", [
		    dataTypePath.happRelease, "happs", "happ_library", "create_happ_release", input
		]);
	    },

	    async updateHappRelease ({ dispatch, getters }, [ id, input ] ) {
		const entity		= getters.happ_release( id ).entity;
		const path		= dataTypePath.happRelease( id );

		log.normal("Updating Happ Release (%s)", String(entity.$addr) );
		return await dispatch("updateEntity", [
		    path, "happs", "happ_library", "update_happ_release", {
			"addr": entity.$addr,
			"properties": input,
		    }
		]);
	    },

	    async unpublishHappRelease ({ dispatch }, id ) {
		const path		= dataTypePath.happRelease( id );

		log.normal("Deleting Happ Release (%s)", String(id) );
		return await dispatch("unpublishEntity", [
		    path, "dnarepo", "dna_library", "delete_happ_release", { id }
		]);
	    },


	    //
	    // Miscellaneous
	    //
	    async fetchHDKVersions ({ dispatch, commit }) {
		const path		= dataTypePath.hdkVersions();

		log.debug("Getting previous HDK versions");
		const hdkvs		= await dispatch("fetchResource", [
		    path, "happs", "happ_library", "get_webhapp_package", { name, id }, 30_000
		]);

		return hdkvs;
	    },

	    async createWebAsset ({ dispatch }, bytes ) {
		log.normal("Creating Web Asset: %s bytes", bytes.length );
		return await dispatch("createEntity", [
		    dataTypePath.webAsset, "webassets", "web_assets", "create_file", {
			"file_bytes": bytes,
		    }
		]);
	    },

	},
    });
};
