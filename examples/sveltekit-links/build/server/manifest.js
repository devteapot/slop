const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.XpwpdXNZ.js",app:"_app/immutable/entry/app.DdDrc9Wo.js",imports:["_app/immutable/entry/start.XpwpdXNZ.js","_app/immutable/chunks/q77SmO8u.js","_app/immutable/chunks/DqHBgsnH.js","_app/immutable/chunks/C_sRh4u4.js","_app/immutable/entry/app.DdDrc9Wo.js","_app/immutable/chunks/DqHBgsnH.js","_app/immutable/chunks/C_sRh4u4.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./chunks/0-CbG2jIGP.js')),
			__memo(() => import('./chunks/1-DNpzWjqA.js')),
			__memo(() => import('./chunks/2-BnaNF_Ds.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();

const prerendered = new Set([]);

const base = "";

export { base, manifest, prerendered };
//# sourceMappingURL=manifest.js.map
