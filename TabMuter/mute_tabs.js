"use strict";

function assert(condition, message) {
	if(!condition) {
		throw message || "Assertion failed";
	}
}

function inspect(obj) {
	return JSON.stringify(obj);
}

function orTrue(v) {
	return typeof v === "boolean" ? v : true;
}

// i.e. tab is in a window of type "normal", not "popup", "panel", "app", or "devtools"
// We don't mute tabs in other types of windows because they are generally trusted
// and there is no UI control for unmuting them.
function isTabInNormalWindow(tab) {
	const windowId = tab.windowId;
	assert(Number.isInteger(windowId));
	return windowIdToType[windowId] === "normal";
}

function muteTab(tab) {
	chrome.tabs.update(tab.id, {muted: true});
}

function unmuteTab(tab) {
	chrome.tabs.update(tab.id, {muted: false});
}

function handleNewTab(tab, doMute) {
	const tabId = tab.id;
	tabIdToTab[tabId] = tab;
	tabIdToUrl[tabId] = null;
	if(doMute) { 
		muteTab(tab);
	}
}

function handleCloseTab(tabId) {
	delete tabIdToTab[tabId];
	delete tabIdToUrl[tabId];
}

function handleNewWindow(window) {
	const windowId = window.id;
	const type     = window.type;
	windowIdToType[windowId] = type;

	//need to find checkbox on window open
	keyChanged("muteAll", settings.muteAllTabs); 
}

function handleCloseWindow(windowId) {
	const type = windowIdToType[windowId];
	delete windowIdToType[windowId];
}

function getOrigin(url) {
	return new URL(url).origin;
}

function navigationCommitted(details) {
	if(details.frameId !== 0) {
		// Ignore navigation in subframes
		return;
	}
	const tabId  = details.tabId;
	const newUrl = details.url;
	const oldUrl = tabIdToUrl[tabId];
	const tab    = tabIdToTab[tabId];
	tabIdToUrl[tabId] = newUrl;
	if(!tab) {
		return;
	}
	if(settings.muteAllTabs) {
		const newOrigin = oldUrl === undefined || (oldUrl !== null && getOrigin(oldUrl) !== getOrigin(newUrl));
		if(newOrigin) {
			muteTab(tab);
		}
	}
}

function messageFromContentScript(request, sender, sendResponse) {
	if(request !== "unmute") {
		return;
	}
	/*if(!settings.unmuteOnVolumeControl) {
		return;
	}*/
	unmuteTab(sender.tab);
}

function getAllWindows() {
	return new Promise(function(resolve) {
		chrome.windows.getAll(resolve);
	});
}

function getAllTabs() {
	return new Promise(function(resolve) {
		chrome.tabs.query({}, resolve);
	});
}

function getStorageLocal(keys) {
	return new Promise(function(resolve) {
		chrome.storage.local.get(keys, resolve);
	});
}

function keyChanged(key, newValue) {
	assert(typeof key === "string");
	if(settings.hasOwnProperty(key)) {
		settings[key] = orTrue(newValue);
	}
	chrome.tabs.getAllInWindow(null, function(tabs){
    for (var i = 0; i < tabs.length; i++) {
		if(newValue===true){
			muteTab(tabs[i]);
			settings.muteAllTabs = true;
		}
		else{
			unmuteTab(tabs[i]);
			settings.muteAllTabs = false;
		}
    }
});
}

function storageChanged(changes, namespace) {
	for(const key in changes) {
		const storageChange = changes[key];
		keyChanged(key, storageChange.newValue);
	}
}

chrome.commands.onCommand.addListener(function(command) {
  chrome.tabs.query({currentWindow: true}, function(tabs) {
	let tab = tabs.findIndex((tab) => { return tab.active; });
    if (command === 'mute-toggle-on')
	{
		muteTab(tab);
	}    
	else  
	{
		unmuteTab(tab);
	}
  });
});

const settings = {
	muteAllTabs:           	true
}
const tabIdToTab     = Object.create(null);
const tabIdToUrl     = Object.create(null);
const windowIdToType = Object.create(null);

async function start() {
	chrome.storage.onChanged.addListener(storageChanged);
	const result = await getStorageLocal(['muteAllTabs']);
	settings.muteAllTabs  = orTrue(result.muteAllTabs);

	chrome.windows.onCreated.addListener(handleNewWindow);
	chrome.windows.onRemoved.addListener(handleCloseWindow);
	const windows = await getAllWindows();
	for(const window of windows) {
		handleNewWindow(window);
	}

	chrome.tabs.onCreated.addListener(tab => handleNewTab(tab, settings.muteAllTabs));
	chrome.tabs.onRemoved.addListener(handleCloseTab);
	const tabs = await getAllTabs();
	for(const tab of tabs) {
		handleNewTab(tab, settings.muteAllTabs);
	}
	chrome.webNavigation.onCommitted.addListener(navigationCommitted);
	chrome.runtime.onMessage.addListener(messageFromContentScript);
}

start();
