/*
 * Product    : AQUILA-CMS
 * Author     : Nextsourcia - contact@aquila-cms.com
 * Copyright  : 2023 © Nextsourcia - All rights reserved.
 * License    : Open Software License (OSL 3.0) - https://opensource.org/licenses/OSL-3.0
 * Disclaimer : Do not edit or add to this file if you wish to upgrade AQUILA CMS to newer versions in the future.
 */
const axios                   = require('axios');
const path                    = require('path');
const Json2csvParser          = require('json2csv').Parser;
const {transforms: {flatten}} = require('json2csv');
const {v4: uuidv4}            = require('uuid');
const mongoose                = require('mongoose');
const {fs}                    = require('aql-utils');
const logger                  = require('./logger');

/**
 *
 * @param {string} moduleName
 * @returns {boolean}
 */
const checkModuleRegistryKey = async (moduleName) => {
    try {
        let registryFile    = path.resolve(global.aquila.modulesPath, moduleName, 'licence.json');
        const aquilaVersion = JSON.parse(await fs.readFile(path.resolve(global.aquila.appRoot, 'package.json'))).version;
        registryFile        = JSON.parse((await fs.readFile(registryFile)));
        if (fs.existsSync(registryFile)) {
            await axios.post('https://stats.aquila-cms.com/api/v1/register', {
                registryKey : registryFile.code,
                aquilaVersion
            });
        } else {
            await axios.post('https://stats.aquila-cms.com/api/v1/register/check', {
                registryKey : registryFile.code,
                aquilaVersion
            });
        }
    } catch (err) { /* TODO improve module registry */ }

    return true;
};

const checkOrCreateAquilaRegistryKey = async () => {
    try {
        const {Configuration, Users} = require('../orm/models');
        const configuration          = await Configuration.findOne({});
        const aquilaVersion          = JSON.parse(await fs.readFile(path.resolve(global.aquila.appRoot, 'package.json'))).version;
        const moment                 = require('moment');
        if (!configuration.licence || !configuration.licence.registryKey) {
            configuration.licence = {
                registryKey : uuidv4(),
                lastCheck   : moment().toISOString()
            };
            const firstAdmin      = await Users.findOne({isAdmin: true}, {_id: 1, isAdmin: 1, email: 1, firstname: 1, lastname: 1, fullname: 1});
            await axios.post('https://stats.aquila-cms.com/api/v1/register', {
                registryKey : configuration.licence.registryKey,
                aquilaVersion,
                user        : firstAdmin
            });
            await configuration.save();
        } else {
            if (moment().toISOString() >= moment(configuration.licence.lastCheck).add(7, 'days').toISOString()) {
                configuration.licence.lastCheck = moment().toISOString();
                await axios.post('https://stats.aquila-cms.com/api/v1/register/check', {
                    registryKey : configuration.licence.registryKey,
                    aquilaVersion,
                    lastCheck   : configuration.licence.lastCheck
                });
                await configuration.save();
            }
        }
    } catch (err) {
        logger.error('Unable to join the Aquila-CMS license server');
    }
};

const json2csv = async (data, fields, folderPath, filename) => {
    let _fields = [];
    for (let i = 0; i < data.length; i++) {
        const line = data[i];
        _fields    = getJSONKeys(_fields, line);
    }
    await fs.mkdir(path.resolve(folderPath), {recursive: true});
    const transforms     = [
        flatten({objects: false, arrays: true})
    ];
    const json2csvParser = new Json2csvParser({fields: _fields.sort((a, b) => a.localeCompare(b)), transforms, delimiter: ';', escapeQuote: '""', quotes: '"'});
    return {
        csv        : json2csvParser.parse(data),
        file       : filename,
        exportPath : folderPath
    };
};

const getJSONKeys = (fields, data, parentKey = '') => {
    for (let ii = 0; ii < Object.keys(data).length; ii++) {
        const key   = Object.keys(data)[ii];
        const value = data[key];
        if (checkForValidMongoDbID.test(value) && !fields.includes(parentKey + key)) {
            // in case of an ObjectId =>
            fields.push(parentKey + key);
        } else if (Array.isArray(value) && value.length > 0) {
            // in case of an arraytoHtmlEntities
            if (typeof value[0] !== 'object') {
                // if it's an string or number array =>
                data[key] = value.join(',');
                if (!fields.includes(parentKey + key)) fields.push(parentKey + key);
            } else if (typeof value[0] === 'object') {
                // if it's an object array =>
                data[key] = {...value};
                fields    = getJSONKeys(fields, data[key], `${parentKey}${key}.`);
            }
        } else if (
            typeof value === 'object'
            && !checkForValidMongoDbID.test(value)
            && value
            && value !== {}
            && !(data[key] instanceof Date)
        ) {
            // in case of an object =>
            fields = getJSONKeys(fields, value, `${parentKey}${key}.`);
        } else if (value && !fields.includes(parentKey + key)) {
            // in case of a string / number
            fields.push(parentKey + key);
        }
    }
    return fields;
};

const checkForValidMongoDbID = /^[0-9a-fA-F]{24}$/;

/**
 * Detect if array contain duplicated values
 * @param {array} a array to check duplicate
 * @returns {boolean} Contains duplicated
 */
const detectDuplicateInArray = (a) => {
    for (let i = 0; i <= a.length; i++) {
        for (let j = i; j <= a.length; j++) {
            if (i !== j && a[i] && a[j] && a[i].toString() === a[j].toString()) {
                return true;
            }
        }
    }
    return false;
};

/**
 * download a file
 * @param {string} url url of the file to download
 * @param {string} dest destination where the file will be downloaded
 * @returns {Promise<string|null>}
 */
const downloadFile = async (url, dest) => {
    // we create the files
    fs.mkdirSync(dest.replace(path.basename(dest), ''), {recursive: true});
    const file        = fs.createWriteStream(dest);
    const downloadDep = url.includes('https://') ? require('https') : require('http');
    return new Promise((resolve, reject) => {
        downloadDep.get(url, (res) => {
            if (res.statusCode !== 200) {
                return reject('File is not found');
            }
            const len      = parseInt(res.headers['content-length'], 10);
            let downloaded = 0;
            res.pipe(file);
            res.on('data', (chunk) => {
                downloaded += chunk.length;
                console.log(`Downloading ${(100.0 * downloaded / len).aqlRound(2)}% ${downloaded} bytes\r`);
            }).on('end', () => {
                file.end();
                resolve(null);
            }).on('error', (err) => {
                reject(err.message);
            });
        }).on('error', (err) => {
            fs.unlink(dest);
            reject(err.message);
        });
    });
};

/**
 *
 * @param {any} obj
 * @param {string} str
 * @returns {any}
 */
const getObjFromDotStr = (obj, str) => {
    if (typeof obj === 'undefined') return;
    if (obj instanceof mongoose.Document) {
        const value = obj.get(str);
        if (value instanceof mongoose.Types.ObjectId) {
            return value.toString();
        }
        return value;
    }
    return str
        .split('.')
        .reduce((o, i) => {
            if (typeof o === 'undefined' || typeof o[i] === 'undefined') return;
            if (o[i] instanceof mongoose.Types.ObjectId) return (o[i]).toString();
            return o[i];
        }, obj);
};

/**
 * Check if two objects or arrays are equal
 * (c) 2017 Chris Ferdinandi, MIT License, https://gomakethings.com
 * @param  {object|Array} value The first object or array to compare
 * @param  {object|Array} other The second object or array to compare
 * @return {Boolean}            Returns true if they're equal
 */
const isEqual = (value, other) => {
    // Get the value type
    const type = Object.prototype.toString.call(value);
    // If the two objects are not the same type, return false
    if (type !== Object.prototype.toString.call(other)) return false;

    // If items are not an object or array, return false
    if (['[object Array]', '[object Object]'].indexOf(type) < 0) return false;

    // Compare the length of the length of the two items
    const valueLen = type === '[object Array]' ? value.length : Object.keys(value).length;
    const otherLen = type === '[object Array]' ? other.length : Object.keys(other).length;
    if (valueLen !== otherLen) return false;

    // Compare properties
    if (type === '[object Array]') {
        for (let i = 0; i < valueLen; i++) {
            if (compare(value[i], other[i]) === false) return false;
        }
    } else {
        for (const key in value) {
            if (value.hasOwnProperty(key)) {
                if (compare(value[key], other[key]) === false) return false;
            }
        }
    }

    // If nothing failed, return true
    return true;
};

/**
 * Compare two items
 * @param {any} item1
 * @param {any} item2
 * @returns {boolean}
 */
let compare = (item1, item2) => {
// Get the object type
    const itemType = Object.prototype.toString.call(item1);
    // If an object or array, compare recursively
    if (['[object Array]', '[object Object]'].indexOf(itemType) >= 0) {
        if (!isEqual(item1, item2)) return false;
    // Otherwise, do a simple comparison
    } else {
        // If the two items are not the same type, return false
        if (itemType !== Object.prototype.toString.call(item2)) return false;
        // Else if it's a function, convert to a string and compare
        // Otherwise, just compare
        if (itemType === '[object Function]') {
            if (item1.toString() !== item2.toString()) return false;
        } else {
            if (item1 !== item2) return false;
        }
    }
};

/**
 * check if a string is parseable as a JSON
 * @param {string} str
 * @returns {boolean}
 */
const isJsonString = (str) => {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
};

/**
 * return a string from a JSON object
 * @param {object}
 * @returns {string}
 */
const stringifyError = (err, filter, space) => {
    const plainObject = {};
    Object.getOwnPropertyNames(err).forEach(function (key) {
        if (key !== 'stack') {
            plainObject[key] = err[key];
        }
    });
    try {
        return JSON.stringify(plainObject, filter, space);
    } catch (e) {
        return JSON.stringify(err, filter, space);
    }
};

/**
 * Check if user is admin
 * @param {object | undefined} info
 * @returns {boolean}
 */
const isAdmin = (info) => info && info.isAdmin;

/**
 * Adds or removes module or theme names in workspaces
 * Useful with modules and themes in order to not be taken into account by yarn workspaces algorithm TODO
 * @param {string} workspaceName
 * @param {string} packageJsonFolder
 * @param {boolean} isAnActivation
 * @returns
 */
const dynamicWorkspacesMgmt = async (workspaceName, packageJsonFolder, isAnActivation) => {
    const packageJsonAbsPath = path.join(global.aquila.appsPath, packageJsonFolder, 'package.json');
    const packageJson        = JSON.parse(await fs.readFile(packageJsonAbsPath));

    if (!packageJson.workspaces) {
        packageJson.workspaces = [];
    }

    const workspaceIndex = packageJson.workspaces.indexOf(workspaceName);
    if (workspaceIndex === -1 && isAnActivation) {
        packageJson.workspaces.push(workspaceName);
    } else if (workspaceIndex !== -1 && !isAnActivation) {
        packageJson.workspaces.splice(workspaceIndex, 1);
    }

    const updatedPackageJson = JSON.stringify(packageJson, null, 2);
    await fs.writeFile(packageJsonAbsPath, updatedPackageJson);
};

module.exports = {
    downloadFile,
    json2csv,
    getObjFromDotStr,
    detectDuplicateInArray,
    checkModuleRegistryKey,
    checkOrCreateAquilaRegistryKey,
    isEqual,
    isJsonString,
    isAdmin,
    stringifyError,
    dynamicWorkspacesMgmt
};
