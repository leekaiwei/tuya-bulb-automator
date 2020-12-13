#!/usr/bin/env node

const TuyApi = require('tuyapi');
const ioHook = require('iohook');
const moment = require('moment');
const exitHook = require('async-exit-hook');
const axios = require('axios').default;
const config = require('./config.json');

const devices = [];
const states = [];

let isLocked = false;
let timeToActivate;
let timeout;
let errorListener;

function changeDeviceState(device, state) { 
  device.find()
    .then(_ => device.connect())
    .then(_ => {
      console.log(`Changing: ${device.name} to ${state}`);
      return device.set({ dps:20, set: state });
    })
    .then(_ => {
      const index = states.findIndex(s => s.id = device.device.id);
      states[index].state = state;
      device.disconnect()
    });

  errorListener = device.on('error', error => {
    console.log(error);
  });     
}

function registerTurnOff() {
  console.log('Registering turn off...');

  const self = this;

  ioHook.registerShortcut(config.turnOffKeys, _ => {
    const now = moment();
    if (now.isAfter(timeToActivate) && !isLocked) {
      const actions = [];
      for (let device of devices) {
        const func = changeDeviceState.bind(self, device, false);
        actions.push(func);
      }

      timeout = setTimeout(() => {
        for (let action of actions) {
          action();
        }
      }, config.delay);

      isLocked = true;
      ioHook.unregisterAllShortcuts();
      registerTurnOn();
    }
  });
}

function registerTurnOn() {
  console.log('Registering turn on...');

  ioHook.on('keydown', _ => {
    clearTimeout(timeout);

    const now = moment();
    if (now.isAfter(timeToActivate) && isLocked) {
      for (let device of devices) {
        changeDeviceState(device, true);
      }

      isLocked = false;
      ioHook.removeAllListeners();
      registerTurnOff();
    }
  });
}

function setCurrentState() {
  console.log(`Active time: ${timeToActivate}`);

  const now = moment();
  if (now.isAfter(timeToActivate)) {
    for (let device of devices) {
      changeDeviceState(device, true);
    }
  } else {
    const timeUntilTimeToActivate = timeToActivate.diff(now, 'milliseconds');
    setTimeout(_ => {
      for (let device of devices) {
        changeDeviceState(device, true);
      }
    }, timeUntilTimeToActivate)
  }
}

exitHook(() => {
  console.log('Cleaning up...');

  for (let device of devices) {
    console.log(`Disconnecting ${device.device.id}...`);
    device.disconnect();
  }

  console.log('Unregistering key events...');
  ioHook.removeAllListeners();
  ioHook.unregisterAllShortcuts();

  console.log('All cleaned up!');
});

for (const deviceConfig of config.devices) {
  const device = new TuyApi({
    id: deviceConfig.id,
    key: deviceConfig.key,
  });

  device.name = deviceConfig.name;

  devices.push(device);
  states.push({
    id: deviceConfig.id,
    state: false,
  })
}

registerTurnOff();

ioHook.start();

console.log('Getting sunset data...');

if (config.testing) {
  timeToActivate = moment().subtract(1, 'seconds');

  setCurrentState();
} else {
  axios.get(`https://api.sunrise-sunset.org/json?lat=${config.location.latitude}&lng=${config.location.longitude}`).then(response => {
    timeToActivate = moment(response.data.results.sunset, 'hh:mm:ss a').subtract(30, 'minutes');
  
    setCurrentState();
  })
}