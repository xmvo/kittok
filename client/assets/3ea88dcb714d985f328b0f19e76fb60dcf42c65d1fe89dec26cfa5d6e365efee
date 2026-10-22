/*!
* @byted/secsdk v1.2.22
* (c) 2024
*/
(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.secsdk = {}));
}(this, (function (exports) { 'use strict';

	var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

	function createCommonjsModule(fn, module) {
		return module = { exports: {} }, fn(module, module.exports), module.exports;
	}

	var check = function (it) {
	  return it && it.Math == Math && it;
	}; // https://github.com/zloirock/core-js/issues/86#issuecomment-115759028


	var global_1 = // eslint-disable-next-line no-undef
	check(typeof globalThis == 'object' && globalThis) || check(typeof window == 'object' && window) || check(typeof self == 'object' && self) || check(typeof commonjsGlobal == 'object' && commonjsGlobal) || // eslint-disable-next-line no-new-func
	function () {
	  return this;
	}() || Function('return this')();

	var fails = function (exec) {
	  try {
	    return !!exec();
	  } catch (error) {
	    return true;
	  }
	};

	var descriptors = !fails(function () {
	  return Object.defineProperty({}, 1, {
	    get: function () {
	      return 7;
	    }
	  })[1] != 7;
	});

	var nativePropertyIsEnumerable = {}.propertyIsEnumerable;
	var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; // Nashorn ~ JDK8 bug

	var NASHORN_BUG = getOwnPropertyDescriptor && !nativePropertyIsEnumerable.call({
	  1: 2
	}, 1); // `Object.prototype.propertyIsEnumerable` method implementation
	// https://tc39.es/ecma262/#sec-object.prototype.propertyisenumerable

	var f = NASHORN_BUG ? function propertyIsEnumerable(V) {
	  var descriptor = getOwnPropertyDescriptor(this, V);
	  return !!descriptor && descriptor.enumerable;
	} : nativePropertyIsEnumerable;
	var objectPropertyIsEnumerable = {
	  f: f
	};

	var createPropertyDescriptor = function (bitmap, value) {
	  return {
	    enumerable: !(bitmap & 1),
	    configurable: !(bitmap & 2),
	    writable: !(bitmap & 4),
	    value: value
	  };
	};

	var toString = {}.toString;

	var classofRaw = function (it) {
	  return toString.call(it).slice(8, -1);
	};

	var split = ''.split; // fallback for non-array-like ES3 and non-enumerable old V8 strings

	var indexedObject = fails(function () {
	  // throws an error in rhino, see https://github.com/mozilla/rhino/issues/346
	  // eslint-disable-next-line no-prototype-builtins
	  return !Object('z').propertyIsEnumerable(0);
	}) ? function (it) {
	  return classofRaw(it) == 'String' ? split.call(it, '') : Object(it);
	} : Object;

	// `RequireObjectCoercible` abstract operation
	// https://tc39.es/ecma262/#sec-requireobjectcoercible
	var requireObjectCoercible = function (it) {
	  if (it == undefined) throw TypeError("Can't call method on " + it);
	  return it;
	};

	var toIndexedObject = function (it) {
	  return indexedObject(requireObjectCoercible(it));
	};

	var isObject = function (it) {
	  return typeof it === 'object' ? it !== null : typeof it === 'function';
	};

	// https://tc39.es/ecma262/#sec-toprimitive
	// instead of the ES6 spec version, we didn't implement @@toPrimitive case
	// and the second argument - flag - preferred type is a string

	var toPrimitive = function (input, PREFERRED_STRING) {
	  if (!isObject(input)) return input;
	  var fn, val;
	  if (PREFERRED_STRING && typeof (fn = input.toString) == 'function' && !isObject(val = fn.call(input))) return val;
	  if (typeof (fn = input.valueOf) == 'function' && !isObject(val = fn.call(input))) return val;
	  if (!PREFERRED_STRING && typeof (fn = input.toString) == 'function' && !isObject(val = fn.call(input))) return val;
	  throw TypeError("Can't convert object to primitive value");
	};

	var hasOwnProperty = {}.hasOwnProperty;

	var has = function (it, key) {
	  return hasOwnProperty.call(it, key);
	};

	var document = global_1.document; // typeof document.createElement is 'object' in old IE

	var EXISTS = isObject(document) && isObject(document.createElement);

	var documentCreateElement = function (it) {
	  return EXISTS ? document.createElement(it) : {};
	};

	var ie8DomDefine = !descriptors && !fails(function () {
	  return Object.defineProperty(documentCreateElement('div'), 'a', {
	    get: function () {
	      return 7;
	    }
	  }).a != 7;
	});

	var nativeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; // `Object.getOwnPropertyDescriptor` method
	// https://tc39.es/ecma262/#sec-object.getownpropertydescriptor

	var f$1 = descriptors ? nativeGetOwnPropertyDescriptor : function getOwnPropertyDescriptor(O, P) {
	  O = toIndexedObject(O);
	  P = toPrimitive(P, true);
	  if (ie8DomDefine) try {
	    return nativeGetOwnPropertyDescriptor(O, P);
	  } catch (error) {
	    /* empty */
	  }
	  if (has(O, P)) return createPropertyDescriptor(!objectPropertyIsEnumerable.f.call(O, P), O[P]);
	};
	var objectGetOwnPropertyDescriptor = {
	  f: f$1
	};

	var anObject = function (it) {
	  if (!isObject(it)) {
	    throw TypeError(String(it) + ' is not an object');
	  }

	  return it;
	};

	var nativeDefineProperty = Object.defineProperty; // `Object.defineProperty` method
	// https://tc39.es/ecma262/#sec-object.defineproperty

	var f$2 = descriptors ? nativeDefineProperty : function defineProperty(O, P, Attributes) {
	  anObject(O);
	  P = toPrimitive(P, true);
	  anObject(Attributes);
	  if (ie8DomDefine) try {
	    return nativeDefineProperty(O, P, Attributes);
	  } catch (error) {
	    /* empty */
	  }
	  if ('get' in Attributes || 'set' in Attributes) throw TypeError('Accessors not supported');
	  if ('value' in Attributes) O[P] = Attributes.value;
	  return O;
	};
	var objectDefineProperty = {
	  f: f$2
	};

	var createNonEnumerableProperty = descriptors ? function (object, key, value) {
	  return objectDefineProperty.f(object, key, createPropertyDescriptor(1, value));
	} : function (object, key, value) {
	  object[key] = value;
	  return object;
	};

	var setGlobal = function (key, value) {
	  try {
	    createNonEnumerableProperty(global_1, key, value);
	  } catch (error) {
	    global_1[key] = value;
	  }

	  return value;
	};

	var SHARED = '__core-js_shared__';
	var store = global_1[SHARED] || setGlobal(SHARED, {});
	var sharedStore = store;

	var functionToString = Function.toString; // this helper broken in `3.4.1-3.4.4`, so we can't use `shared` helper

	if (typeof sharedStore.inspectSource != 'function') {
	  sharedStore.inspectSource = function (it) {
	    return functionToString.call(it);
	  };
	}

	var inspectSource = sharedStore.inspectSource;

	var WeakMap = global_1.WeakMap;
	var nativeWeakMap = typeof WeakMap === 'function' && /native code/.test(inspectSource(WeakMap));

	var shared = createCommonjsModule(function (module) {
	  (module.exports = function (key, value) {
	    return sharedStore[key] || (sharedStore[key] = value !== undefined ? value : {});
	  })('versions', []).push({
	    version: '3.8.2',
	    mode:  'global',
	    copyright: '© 2021 Denis Pushkarev (zloirock.ru)'
	  });
	});

	var id = 0;
	var postfix = Math.random();

	var uid = function (key) {
	  return 'Symbol(' + String(key === undefined ? '' : key) + ')_' + (++id + postfix).toString(36);
	};

	var keys = shared('keys');

	var sharedKey = function (key) {
	  return keys[key] || (keys[key] = uid(key));
	};

	var hiddenKeys = {};

	var WeakMap$1 = global_1.WeakMap;
	var set, get, has$1;

	var enforce = function (it) {
	  return has$1(it) ? get(it) : set(it, {});
	};

	var getterFor = function (TYPE) {
	  return function (it) {
	    var state;

	    if (!isObject(it) || (state = get(it)).type !== TYPE) {
	      throw TypeError('Incompatible receiver, ' + TYPE + ' required');
	    }

	    return state;
	  };
	};

	if (nativeWeakMap) {
	  var store$1 = sharedStore.state || (sharedStore.state = new WeakMap$1());
	  var wmget = store$1.get;
	  var wmhas = store$1.has;
	  var wmset = store$1.set;

	  set = function (it, metadata) {
	    metadata.facade = it;
	    wmset.call(store$1, it, metadata);
	    return metadata;
	  };

	  get = function (it) {
	    return wmget.call(store$1, it) || {};
	  };

	  has$1 = function (it) {
	    return wmhas.call(store$1, it);
	  };
	} else {
	  var STATE = sharedKey('state');
	  hiddenKeys[STATE] = true;

	  set = function (it, metadata) {
	    metadata.facade = it;
	    createNonEnumerableProperty(it, STATE, metadata);
	    return metadata;
	  };

	  get = function (it) {
	    return has(it, STATE) ? it[STATE] : {};
	  };

	  has$1 = function (it) {
	    return has(it, STATE);
	  };
	}

	var internalState = {
	  set: set,
	  get: get,
	  has: has$1,
	  enforce: enforce,
	  getterFor: getterFor
	};

	var redefine = createCommonjsModule(function (module) {
	  var getInternalState = internalState.get;
	  var enforceInternalState = internalState.enforce;
	  var TEMPLATE = String(String).split('String');
	  (module.exports = function (O, key, value, options) {
	    var unsafe = options ? !!options.unsafe : false;
	    var simple = options ? !!options.enumerable : false;
	    var noTargetGet = options ? !!options.noTargetGet : false;
	    var state;

	    if (typeof value == 'function') {
	      if (typeof key == 'string' && !has(value, 'name')) {
	        createNonEnumerableProperty(value, 'name', key);
	      }

	      state = enforceInternalState(value);

	      if (!state.source) {
	        state.source = TEMPLATE.join(typeof key == 'string' ? key : '');
	      }
	    }

	    if (O === global_1) {
	      if (simple) O[key] = value;else setGlobal(key, value);
	      return;
	    } else if (!unsafe) {
	      delete O[key];
	    } else if (!noTargetGet && O[key]) {
	      simple = true;
	    }

	    if (simple) O[key] = value;else createNonEnumerableProperty(O, key, value); // add fake Function#toString for correct work wrapped methods / constructors with methods like LoDash isNative
	  })(Function.prototype, 'toString', function toString() {
	    return typeof this == 'function' && getInternalState(this).source || inspectSource(this);
	  });
	});

	var path = global_1;

	var aFunction = function (variable) {
	  return typeof variable == 'function' ? variable : undefined;
	};

	var getBuiltIn = function (namespace, method) {
	  return arguments.length < 2 ? aFunction(path[namespace]) || aFunction(global_1[namespace]) : path[namespace] && path[namespace][method] || global_1[namespace] && global_1[namespace][method];
	};

	var ceil = Math.ceil;
	var floor = Math.floor; // `ToInteger` abstract operation
	// https://tc39.es/ecma262/#sec-tointeger

	var toInteger = function (argument) {
	  return isNaN(argument = +argument) ? 0 : (argument > 0 ? floor : ceil)(argument);
	};

	var min = Math.min; // `ToLength` abstract operation
	// https://tc39.es/ecma262/#sec-tolength

	var toLength = function (argument) {
	  return argument > 0 ? min(toInteger(argument), 0x1FFFFFFFFFFFFF) : 0; // 2 ** 53 - 1 == 9007199254740991
	};

	var max = Math.max;
	var min$1 = Math.min; // Helper for a popular repeating case of the spec:
	// Let integer be ? ToInteger(index).
	// If integer < 0, let result be max((length + integer), 0); else let result be min(integer, length).

	var toAbsoluteIndex = function (index, length) {
	  var integer = toInteger(index);
	  return integer < 0 ? max(integer + length, 0) : min$1(integer, length);
	};

	var createMethod = function (IS_INCLUDES) {
	  return function ($this, el, fromIndex) {
	    var O = toIndexedObject($this);
	    var length = toLength(O.length);
	    var index = toAbsoluteIndex(fromIndex, length);
	    var value; // Array#includes uses SameValueZero equality algorithm
	    // eslint-disable-next-line no-self-compare

	    if (IS_INCLUDES && el != el) while (length > index) {
	      value = O[index++]; // eslint-disable-next-line no-self-compare

	      if (value != value) return true; // Array#indexOf ignores holes, Array#includes - not
	    } else for (; length > index; index++) {
	      if ((IS_INCLUDES || index in O) && O[index] === el) return IS_INCLUDES || index || 0;
	    }
	    return !IS_INCLUDES && -1;
	  };
	};

	var arrayIncludes = {
	  // `Array.prototype.includes` method
	  // https://tc39.es/ecma262/#sec-array.prototype.includes
	  includes: createMethod(true),
	  // `Array.prototype.indexOf` method
	  // https://tc39.es/ecma262/#sec-array.prototype.indexof
	  indexOf: createMethod(false)
	};

	var indexOf = arrayIncludes.indexOf;

	var objectKeysInternal = function (object, names) {
	  var O = toIndexedObject(object);
	  var i = 0;
	  var result = [];
	  var key;

	  for (key in O) !has(hiddenKeys, key) && has(O, key) && result.push(key); // Don't enum bug & hidden keys


	  while (names.length > i) if (has(O, key = names[i++])) {
	    ~indexOf(result, key) || result.push(key);
	  }

	  return result;
	};

	// IE8- don't enum bug keys
	var enumBugKeys = ['constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf'];

	var hiddenKeys$1 = enumBugKeys.concat('length', 'prototype'); // `Object.getOwnPropertyNames` method
	// https://tc39.es/ecma262/#sec-object.getownpropertynames

	var f$3 = Object.getOwnPropertyNames || function getOwnPropertyNames(O) {
	  return objectKeysInternal(O, hiddenKeys$1);
	};

	var objectGetOwnPropertyNames = {
	  f: f$3
	};

	var f$4 = Object.getOwnPropertySymbols;
	var objectGetOwnPropertySymbols = {
	  f: f$4
	};

	var ownKeys = getBuiltIn('Reflect', 'ownKeys') || function ownKeys(it) {
	  var keys = objectGetOwnPropertyNames.f(anObject(it));
	  var getOwnPropertySymbols = objectGetOwnPropertySymbols.f;
	  return getOwnPropertySymbols ? keys.concat(getOwnPropertySymbols(it)) : keys;
	};

	var copyConstructorProperties = function (target, source) {
	  var keys = ownKeys(source);
	  var defineProperty = objectDefineProperty.f;
	  var getOwnPropertyDescriptor = objectGetOwnPropertyDescriptor.f;

	  for (var i = 0; i < keys.length; i++) {
	    var key = keys[i];
	    if (!has(target, key)) defineProperty(target, key, getOwnPropertyDescriptor(source, key));
	  }
	};

	var replacement = /#|\.prototype\./;

	var isForced = function (feature, detection) {
	  var value = data[normalize(feature)];
	  return value == POLYFILL ? true : value == NATIVE ? false : typeof detection == 'function' ? fails(detection) : !!detection;
	};

	var normalize = isForced.normalize = function (string) {
	  return String(string).replace(replacement, '.').toLowerCase();
	};

	var data = isForced.data = {};
	var NATIVE = isForced.NATIVE = 'N';
	var POLYFILL = isForced.POLYFILL = 'P';
	var isForced_1 = isForced;

	var getOwnPropertyDescriptor$1 = objectGetOwnPropertyDescriptor.f;
	/*
	  options.target      - name of the target object
	  options.global      - target is the global object
	  options.stat        - export as static methods of target
	  options.proto       - export as prototype methods of target
	  options.real        - real prototype method for the `pure` version
	  options.forced      - export even if the native feature is available
	  options.bind        - bind methods to the target, required for the `pure` version
	  options.wrap        - wrap constructors to preventing global pollution, required for the `pure` version
	  options.unsafe      - use the simple assignment of property instead of delete + defineProperty
	  options.sham        - add a flag to not completely full polyfills
	  options.enumerable  - export as enumerable property
	  options.noTargetGet - prevent calling a getter on target
	*/

	var _export = function (options, source) {
	  var TARGET = options.target;
	  var GLOBAL = options.global;
	  var STATIC = options.stat;
	  var FORCED, target, key, targetProperty, sourceProperty, descriptor;

	  if (GLOBAL) {
	    target = global_1;
	  } else if (STATIC) {
	    target = global_1[TARGET] || setGlobal(TARGET, {});
	  } else {
	    target = (global_1[TARGET] || {}).prototype;
	  }

	  if (target) for (key in source) {
	    sourceProperty = source[key];

	    if (options.noTargetGet) {
	      descriptor = getOwnPropertyDescriptor$1(target, key);
	      targetProperty = descriptor && descriptor.value;
	    } else targetProperty = target[key];

	    FORCED = isForced_1(GLOBAL ? key : TARGET + (STATIC ? '.' : '#') + key, options.forced); // contained in target

	    if (!FORCED && targetProperty !== undefined) {
	      if (typeof sourceProperty === typeof targetProperty) continue;
	      copyConstructorProperties(sourceProperty, targetProperty);
	    } // add a flag to not completely full polyfills


	    if (options.sham || targetProperty && targetProperty.sham) {
	      createNonEnumerableProperty(sourceProperty, 'sham', true);
	    } // extend global


	    redefine(target, key, sourceProperty, options);
	  }
	};

	var aFunction$1 = function (it) {
	  if (typeof it != 'function') {
	    throw TypeError(String(it) + ' is not a function');
	  }

	  return it;
	};

	var PromiseCapability = function (C) {
	  var resolve, reject;
	  this.promise = new C(function ($$resolve, $$reject) {
	    if (resolve !== undefined || reject !== undefined) throw TypeError('Bad Promise constructor');
	    resolve = $$resolve;
	    reject = $$reject;
	  });
	  this.resolve = aFunction$1(resolve);
	  this.reject = aFunction$1(reject);
	}; // 25.4.1.5 NewPromiseCapability(C)


	var f$5 = function (C) {
	  return new PromiseCapability(C);
	};

	var newPromiseCapability = {
	  f: f$5
	};

	var perform = function (exec) {
	  try {
	    return {
	      error: false,
	      value: exec()
	    };
	  } catch (error) {
	    return {
	      error: true,
	      value: error
	    };
	  }
	};

	// https://github.com/tc39/proposal-promise-try


	_export({
	  target: 'Promise',
	  stat: true
	}, {
	  'try': function (callbackfn) {
	    var promiseCapability = newPromiseCapability.f(this);
	    var result = perform(callbackfn);
	    (result.error ? promiseCapability.reject : promiseCapability.resolve)(result.value);
	    return promiseCapability.promise;
	  }
	});

	var version = "1.2.22";

	const IS_FETCH_API_SUPPORTED = ('fetch' in window);
	const IS_REQUEST_API_SUPPORTED = ('Request' in window);
	const IS_HEADERS_API_SUPPORTED = ('Headers' in window);
	const DOWNGRADE_FLAG = 'DOWNGRADE';
	const DEFAULT_HOST_PROTECTION_CONFIG = {
	  POST: '*',
	  PUT: '*',
	  PATCH: '*',
	  DELETE: '*'
	};
	const DEFAULT_NORMAL_TOKEN_MAX_AGE = 24 * 60 * 60 * 1000;
	const DEFAULT_DOWNGRADE_TOKEN_MAX_AGE = 1000;
	const TOKEN_PATH_KEY = 'TOKEN_PATH';

	class CSRFDefenser {
	  constructor() {
	    this.tokenHeaderName = 'x-secsdk-csrf-token';
	    this.tokenFetchTimeout = 10000;
	    this.secsdkVersionHeaderName = 'x-secsdk-csrf-version';
	    this.secsdkSessionName = 'x-secsdk-csrf-session';
	    this.defaultSessionVal = '1';
	    this.nativeXMLHttpRequest = window.XMLHttpRequest.prototype.constructor;
	    this.nativeXMLHttpRequestOpen = window.XMLHttpRequest.prototype.open;
	    this.nativeXMLHttpRequestSend = window.XMLHttpRequest.prototype.send;
	    this.nativeXMLHttpRequestSetRequestHeader = window.XMLHttpRequest.prototype.setRequestHeader;
	    this.nativeFetch = window.fetch;
	    this.tokenMap = {};
	    this.protectionConfig = {};
	    this.whiteListConfig = {};
	    this.secsdkVersion = version;
	    this.downgradeMaxAge = DEFAULT_DOWNGRADE_TOKEN_MAX_AGE;
	    this.downgradeLimit = -1;
	    this.downgradeLimitMap = {};
	    this.monkeyPatchXMLHttpRequest();
	    this.monkeyPatchFetch();
	  }

	  setProtectedHost() {
	    let host = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : window.location.host;
	    this.protectionConfig = {};

	    if (typeof host === 'string') {
	      this.protectionConfig[host] = Object.assign({}, DEFAULT_HOST_PROTECTION_CONFIG);
	    } else if (Array.isArray(host)) {
	      host.forEach(h => {
	        this.protectionConfig[h] = Object.assign({}, DEFAULT_HOST_PROTECTION_CONFIG);
	      });
	    } else if (Object.prototype.toString.call(host) === '[object Object]') {
	      Object.keys(host).forEach(h => {
	        this.protectionConfig[h] = Object.assign({}, DEFAULT_HOST_PROTECTION_CONFIG);
	        const hostProtectionConfig = host[h];

	        if (Object.prototype.toString.call(hostProtectionConfig) === '[object Object]') {
	          Object.keys(hostProtectionConfig).forEach(m => {
	            this.protectionConfig[h][m.toUpperCase()] = hostProtectionConfig[m];
	          });
	        }
	      });
	    }
	  }

	  setAllowedHost(host) {
	    Object.keys(host).forEach(h => {
	      this.whiteListConfig[h] = {};
	      const hostProtectionConfig = host[h];
	      Object.keys(hostProtectionConfig).forEach(m => {
	        this.whiteListConfig[h][m.toUpperCase()] = hostProtectionConfig[m];
	      });
	    });
	  }

	  setOptions() {
	    let options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

	    if (typeof options !== 'object') {
	      return;
	    }

	    const isGlueOptions = Object.keys(options).includes('protect');

	    if (isGlueOptions) {
	      const {
	        protect = {},
	        allow = {},
	        downgradeLimit = -1,
	        downgradeMaxAge = 1000,
	        tokenFetchTimeout = 10000
	      } = options;
	      this.setProtectedHost(protect);
	      this.setAllowedHost(allow);
	      this.setDowngradeLimit(downgradeLimit);
	      this.setDowngradeMaxAge(downgradeMaxAge);
	      this.setTokenFetchTimeout(tokenFetchTimeout);
	      return;
	    }

	    this.setProtectedHost(options);
	  }

	  setDowngradeMaxAge() {
	    let downgradeMaxAge = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1000;
	    this.downgradeMaxAge = downgradeMaxAge;
	  }

	  setDowngradeLimit() {
	    let limit = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : -1;
	    this.downgradeLimit = limit;
	  }

	  setTokenFetchTimeout() {
	    let tokenFetchTimeout = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 10000;
	    this.tokenFetchTimeout = tokenFetchTimeout;
	  } // eslint-disable-next-line max-len


	  fetchToken() {
	    let host = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : window.location.host;
	    let pathname = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : window.location.pathname;

	    if (Array.isArray(host)) {
	      return Promise.all(host.map(h => this.fetchToken(h)));
	    }

	    if (!this.tokenMap[host]) {
	      this.tokenMap[host] = this.fetchTokenFromServer(host, this.getTokenPath(host, pathname)).then(token => {
	        // replace token fetching promise with token
	        this.tokenMap[host] = token;
	        return token;
	      });
	    }

	    return Promise.resolve(this.tokenMap[host]).then(token => {
	      if (token.expiredAt < Date.now()) {
	        // 1. fix fetch token timeout recursion
	        // 2. check custom timeout downgrade limit
	        if (this.downgradeLimit === -1 && !token.timeout || !this.checkDowngradeLimit(host)) {
	          delete this.tokenMap[host];
	          this.removeCrossSiteSessionFromStorage(host);
	          return this.fetchToken(host, pathname);
	        }
	      } // cache


	      return token;
	    });
	  }

	  fetchTokenFromLocal(host) {
	    const token = this.tokenMap[host];

	    if (token && !(token instanceof Promise)) {
	      return token.value;
	    }

	    return DOWNGRADE_FLAG;
	  }

	  incrementDowngradeLimitCount(host) {
	    if (this.downgradeLimit === -1) {
	      return;
	    }

	    const limit = this.downgradeLimitMap[host] || 0;
	    this.downgradeLimitMap[host] = limit + 1;
	  }

	  checkDowngradeLimit(host) {
	    if (this.downgradeLimit === -1) {
	      return false;
	    }

	    const limit = this.downgradeLimitMap[host] || 0;
	    return limit >= this.downgradeLimit;
	  }

	  isCrossSite(sourceUrl) {
	    var _a, _b;

	    const {
	      protocol: p1,
	      host: h1
	    } = new URL(window.location.href);
	    const {
	      protocol: p2,
	      host: h2
	    } = new URL(sourceUrl, window.location.href);

	    if (!(p1 === p2 && h1 === h2)) {
	      // iframe 本身跨站
	      return true;
	    } // iframe本身同站，则判断top是否跨站


	    try {
	      const _url = (_b = (_a = window.top) === null || _a === void 0 ? void 0 : _a.location) === null || _b === void 0 ? void 0 : _b.href; // 访问该对象属性，可能存在跨域报错


	      if (!_url) {
	        return true;
	      }

	      const {
	        protocol: p0,
	        host: h0
	      } = new URL(_url);
	      return !(p0 === p2 && h0 === h2);
	    } catch (e) {
	      return true;
	    }
	  }

	  getCrossSiteSessionMapFromStorage() {
	    return JSON.parse(window.localStorage.getItem(this.secsdkSessionName) || '{}');
	  }

	  removeCrossSiteSessionFromStorage(host) {
	    const sessionMap = this.getCrossSiteSessionMapFromStorage();
	    delete sessionMap[host];
	    window.localStorage.setItem(this.secsdkSessionName, JSON.stringify(sessionMap));
	  }

	  fetchTokenFromServer(host, pathname) {
	    const defenser = this;
	    return new Promise(resolve => {
	      const XMLHttpRequest = this.nativeXMLHttpRequest;
	      const xhr = new XMLHttpRequest();
	      const downgradeToken = {
	        value: DOWNGRADE_FLAG,
	        expiredAt: Date.now() + this.downgradeMaxAge,
	        timeout: false
	      };
	      const protocol = ['http:', 'https:'].includes(window.location.protocol) ? window.location.protocol : 'https:';

	      if (this.checkDowngradeLimit(host)) {
	        console.error(new Error(`Failed to fetch csrf token: host=${host} downgradeLimit: ${this.downgradeLimit}`));
	        resolve(downgradeToken);
	        return;
	      }

	      xhr.addEventListener('load', () => {
	        if (xhr.status !== 200) {
	          console.error(new Error(`Failed to fetch csrf token: host=${host} status=${xhr.status} statusText=${xhr.statusText}`));
	          resolve(downgradeToken);
	          this.incrementDowngradeLimitCount(host);
	          return;
	        }

	        let tokenInfo = [];
	        const csrfHeaderValue = xhr.getResponseHeader('x-ware-csrf-token');

	        if (csrfHeaderValue) {
	          // [statusCode,token,maxAge,message,sessionId] = tokenInfo;
	          tokenInfo = csrfHeaderValue.split(',');
	        } else {
	          console.warn(`Failed to get csrf token: host=${host} xWareCsrfToken=${csrfHeaderValue}`);
	          resolve(downgradeToken);
	          this.incrementDowngradeLimitCount(host);
	          return;
	        }

	        if (!(tokenInfo[0] === '0')) {
	          console.warn(`Failed to fetch csrf token: host=${host} status_code=${tokenInfo[0]} message=${tokenInfo[3]}`);
	          resolve(downgradeToken);
	          this.incrementDowngradeLimitCount(host);
	          return;
	        }

	        if (!tokenInfo[1]) {
	          console.warn(`Failed to fetch csrf token, empty token: host=${host} data=${tokenInfo}`);
	          resolve(downgradeToken);
	          this.incrementDowngradeLimitCount(host);
	          return;
	        }

	        if (defenser.isCrossSite(`${protocol}//${host}${pathname}`)) {
	          // 跨站Cookie写入localStorage，区分domain
	          const sessionMap = defenser.getCrossSiteSessionMapFromStorage();
	          window.localStorage.setItem(defenser.secsdkSessionName, JSON.stringify(Object.assign(Object.assign({}, sessionMap), {
	            [host]: tokenInfo[4]
	          })));
	        }

	        const maxAge = parseInt(tokenInfo[2], 10) || DEFAULT_NORMAL_TOKEN_MAX_AGE;
	        resolve({
	          value: tokenInfo[1],
	          expiredAt: Date.now() + maxAge,
	          timeout: false
	        });
	      });
	      xhr.addEventListener('error', () => {
	        console.error(new Error(`Failed to fetch csrf token: host=${host} error=network request failed`));
	        resolve(downgradeToken);
	        this.incrementDowngradeLimitCount(host);
	      });
	      xhr.addEventListener('abort', () => {
	        console.error(new Error(`Failed to fetch csrf token: host=${host} error=network request aborted`));
	        resolve(downgradeToken);
	        this.incrementDowngradeLimitCount(host);
	      });
	      xhr.addEventListener('timeout', () => {
	        console.error(new Error(`Failed to fetch csrf token: host=${host} error=timeout`));
	        downgradeToken.timeout = true;
	        resolve(downgradeToken);
	        this.incrementDowngradeLimitCount(host);
	      });
	      this.nativeXMLHttpRequestOpen.call(xhr, 'HEAD', `${protocol}//${host}${pathname}`);
	      const sessionId = defenser.defaultSessionVal;
	      this.nativeXMLHttpRequestSetRequestHeader.call(xhr, 'x-secsdk-csrf-request', sessionId);
	      this.nativeXMLHttpRequestSetRequestHeader.call(xhr, this.secsdkVersionHeaderName, this.secsdkVersion);
	      xhr.withCredentials = true;
	      xhr.timeout = this.tokenFetchTimeout;
	      this.nativeXMLHttpRequestSend.call(xhr);
	    });
	  }

	  matchConfig(config, host, method, pathname) {
	    method = method.toUpperCase();
	    const pc = config;

	    if (!pc[host]) {
	      return false;
	    }

	    if (!pc[host][method]) {
	      return false;
	    }

	    const mpc = pc[host][method];

	    if (mpc instanceof RegExp) {
	      return mpc.test(pathname);
	    } else if (Array.isArray(mpc)) {
	      return mpc.some(item => {
	        if (item instanceof RegExp) {
	          return item.test(pathname);
	        }

	        return item === pathname;
	      });
	    }

	    return mpc === '*' || mpc === pathname;
	  }

	  shouldAllowRequest(host, method, pathname) {
	    return this.matchConfig(this.whiteListConfig, host, method, pathname);
	  }

	  shouldProtectRequest(host, method, pathname) {
	    return this.matchConfig(this.protectionConfig, host, method, pathname);
	  }

	  getTokenPath(host, pathname) {
	    const pc = this.protectionConfig;

	    if (!pc[host]) {
	      return pathname;
	    }

	    if (pc[host][TOKEN_PATH_KEY]) {
	      return pc[host][TOKEN_PATH_KEY];
	    }

	    return pathname;
	  }

	  monkeyPatchXMLHttpRequest() {
	    const defenser = this;

	    XMLHttpRequest.prototype.open = function () {
	      // Save open arguments, we use it in `send` method.
	      this.openArgs = arguments;
	      defenser.nativeXMLHttpRequestOpen.apply(this, arguments);
	    };

	    XMLHttpRequest.prototype.send = function () {
	      const {
	        openArgs
	      } = this;
	      const sendArgs = arguments;
	      const method = openArgs[0] || 'GET';
	      const u = new URL(openArgs[1], window.location.href); // Send request immediately if current request in the whitelist

	      if (defenser.shouldAllowRequest(u.hostname, method, u.pathname)) {
	        return defenser.nativeXMLHttpRequestSend.apply(this, sendArgs);
	      } // Send request immediately if current request is safe.


	      if (!defenser.shouldProtectRequest(u.host, method, u.pathname)) {
	        return defenser.nativeXMLHttpRequestSend.apply(this, sendArgs);
	      } // Set csrf token synchronously and send request immediately if current request is not async.


	      if (openArgs.length >= 3 && !openArgs[2]) {
	        let token = defenser.fetchTokenFromLocal(u.host);

	        if (defenser.isCrossSite(`${u.protocol}//${u.host}${u.pathname}`)) {
	          const sessionId = defenser.getCrossSiteSessionMapFromStorage()[u.host]; //跨站请求，sessionId以 req header传送

	          sessionId && (token = `${token},${sessionId}`);
	        }

	        defenser.nativeXMLHttpRequestSetRequestHeader.call(this, defenser.tokenHeaderName, token);
	        return defenser.nativeXMLHttpRequestSend.apply(this, sendArgs);
	      } // Set csrf token and send request asynchronously


	      defenser.fetchToken(u.host, u.pathname).then(token => {
	        let tokenVal = token.value;

	        if (defenser.isCrossSite(`${u.protocol}//${u.host}${u.pathname}`)) {
	          const sessionId = defenser.getCrossSiteSessionMapFromStorage()[u.host]; //跨站请求，sessionId以 req header传送

	          sessionId && (tokenVal = `${tokenVal},${sessionId}`);
	        }

	        defenser.nativeXMLHttpRequestSetRequestHeader.call(this, defenser.tokenHeaderName, tokenVal);
	        defenser.nativeXMLHttpRequestSend.apply(this, sendArgs);
	      });
	    };
	  }

	  monkeyPatchFetch() {
	    if (!IS_FETCH_API_SUPPORTED) {
	      return;
	    }

	    const defenser = this;

	    window.fetch = function (input, init) {
	      let url, method;

	      if (IS_REQUEST_API_SUPPORTED && input instanceof Request) {
	        url = input.url;
	        method = input.method;
	      } else {
	        url = input;
	        method = init && init.method ? init.method : 'GET';
	      }

	      const u = new URL(url, window.location.href); // Send request immediately if current request in the whitelist

	      if (defenser.shouldAllowRequest(u.hostname, method, u.pathname)) {
	        return defenser.nativeFetch.apply(this, [input, init]);
	      } // Send request immediately if current request is safe.


	      if (!defenser.shouldProtectRequest(u.host, method, u.pathname)) {
	        return defenser.nativeFetch.apply(this, [input, init]);
	      } // Set csrf token header before sending request.


	      return defenser.fetchToken(u.host, u.pathname).then(token => {
	        let tokenVal = token.value;
	        const sessionId = defenser.getCrossSiteSessionMapFromStorage()[u.host];

	        if (defenser.isCrossSite(`${u.protocol}//${u.host}${u.pathname}`)) {
	          //跨站请求，sessionId以 req header传送
	          sessionId && (tokenVal = `${tokenVal},${sessionId}`);
	        }

	        if (IS_REQUEST_API_SUPPORTED && input instanceof Request) {
	          input.headers.set(defenser.tokenHeaderName, tokenVal);
	        } else {
	          init = init || {};
	          init.headers = init.headers || {};

	          if (IS_HEADERS_API_SUPPORTED && init.headers instanceof Headers) {
	            init.headers.set(defenser.tokenHeaderName, tokenVal);
	          } else if (Array.isArray(init.headers)) {
	            let flag = false;
	            init.headers.forEach(item => {
	              if (item[0] === defenser.tokenHeaderName) {
	                item[1] = tokenVal;
	                flag = true;
	              }
	            });

	            if (!flag) {
	              init.headers.push([defenser.tokenHeaderName, tokenVal]);
	            }
	          } else {
	            init.headers[defenser.tokenHeaderName] = tokenVal;
	          }
	        }

	        return defenser.nativeFetch.apply(this, [input, init]);
	      });
	    };
	  }

	}

	const csrf = new CSRFDefenser();

	exports.csrf = csrf;

	Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=index.umd.js.map
