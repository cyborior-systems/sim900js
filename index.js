/* 
* @Author: Mike Reich, Manish Pratap Singh
*/

'use strict';

var SerialPort = require("serialport");

class SIM900 {

    /**
     * SMS callback function to be called once sms is received. 
     */
    smsCallback = null;
    debug = false;

    constructor(uart, baud) {
        this._uart = uart;
        this._baud = baud;
        this._clear();
        this._sp = new SerialPort(this._uart, {
            baudRate: this._baud,
            autoOpen: false
        }, false);
    }
    _handleData(data) {
        this._log("debug", 'incoming data', data.toString());
        this._buffer += data;
    }
    _handleError(error) {
        this._error = error;
    }
    _clear() {
        this._buffer = null;
        this._error = null;
    }
    _writeCommand(buf, timeout, cb) {
        this._clear();
        var that = this;
        var originalBuf = buf;
        if (buf && buf.length > 0 && buf[buf.length - 1] != String.fromCharCode(13))
            buf = buf + String.fromCharCode(13);
        this._log("debug", 'writing', buf.toString());
        this._sp.write(buf, function (err) {
            that._sp.drain(function () {
                setTimeout(function () {
                    that._handleResponse(originalBuf, cb);
                }, timeout);
            });
        });
    }
    _writeCommandSequence(commands, timeout, cb) {
        var that = this;
        if (typeof timeout === 'function') {
            cb = timeout;
            timeout = null;
        }
        var processCommand = function (err, result) {
            if (err)
                return cb(err);
            if (commands.length === 0)
                return cb(err, result);
            var command = commands.shift();
            if (Array.isArray(command)) {
                timeout = command[1];
                command = command[0];
            }
            that._writeCommand(command, timeout, processCommand);
        };
        processCommand();
    }
    _handleResponse(buf, cb) {
        var response = null;
        var error = null;
        if (!this._buffer)
            return cb(error, response);
        var raw = this._buffer.toString().split("\r");
        this._log("debug", 'raw', raw);
        raw.forEach(function (res) {
            res = res.trim();
            if (res === '')
                return;
            if (res != buf && res[0] == "+")
                return error = res.substr(1, res.length - 1);
            if (res == "OK" || res == ">") {
                response = error || res;
                error = null;
            }
        });
        cb(error, response, raw);
    }
    connect(cb) {
        this._log("debug", 'opening connection');
        var that = this;
        this._sp.open(function (err) {
            that._sp.on('data', that._handleData.bind(that));
            that._sp.on('error', that._handleError.bind(that));
            cb(err);
        });
    }
    close(cb) {
        this._sp.close();
    }
    status(cb) {
        var that = this;
        this._writeCommand("AT+CREG?", 100, cb);
    }
    sendSMS(number, message, cb) {
        var commands = [
            ["AT", 500],
            ["AT+CMGF=1", 500],
            ["AT+CMGS=\"+" + number + "\"", 500],
            [message + String.fromCharCode(parseInt("1A", 16)), 5000]
        ];
        this._writeCommandSequence(commands, function (err, res) {
            cb(err, res);
        });
    }

    /**
     * Initialize SMS Notification.
     * @param {*} smsCallback Callback to be called once sms received , parameters will be number, receivedOn, message
     * @param {*} cb Callback to be called after the initialization complted with error or response. 
     */
    initializeSmsNotification(smsCallback, cb) {
        this.smsCallback = smsCallback;

        var commands = [
            ["AT", 500],
            ["AT+CMGF=1", 500],
            ["AT+CNMI=1,2,0,0,0", 500]
        ]

        this._writeCommandSequence(commands, function (err, res) {
            cb(err, res);
        });
    }

    initializeGPRS(apn, user, pass, cb) {
        var commands = [
            "AT+SAPBR=3,1,\"APN\",\"" + apn + "\"",
            "AT+SAPBR=3,1,\"USER\",\"" + user + "\"",
            "AT+SAPBR=3,1,\"PWD\",\"" + pass + "\"",
            "AT+SAPBR=1,1"
        ];
        this._writeCommandSequence(commands, 500, function (err, res) {
            cb(err, res);
        });
    }
    HTTPGet(url, cb) {
        var that = this;
        var method = 0;
        var commands = [
            "AT+HTTPINIT",
            "AT+HTTPPARA=\"CID\",1",
            "AT+HTTPPARA=\"URL\",\"" + url + "\"",
            ["AT+HTTPACTION=" + method, 15000]
        ];
        this._writeCommandSequence(commands, 500, function (err, res) {
            if (err && err.indexOf("HTTPACTION:" + method + ",200") > -1) {
                var bytes = err.replace("HTTPACTION:0,200,", "");
                that._readHTTPResponse(bytes, 0, cb);
            }
            that._writeCommand("AT+HTTPTERM", 100, function () { });
            return cb(err, res);
        });
    }
    HTTPPost(url, data, content_type, cb) {
        var that = this;
        var method = 1;
        var commands = [
            "AT+HTTPINIT",
            "AT+HTTPPARA=\"CID\",1",
            "AT+HTTPPARA=\"URL\",\"" + url + "\"",
            "AT+HTTPPARA=\"CONTENT\",\"" + content_type + "\"",
            ["AT+HTTPDATA=" + data.length + "," + 10000, 1000],
            [data + String.fromCharCode(parseInt("1A", 16)), 5000],
            ["AT+HTTPACTION=1", 5000]
        ];
        this._writeCommandSequence(commands, 500, function (err, res) {
            if (err && err.indexOf("HTTPACTION1:1,2") > -1) {
                var bytes = err.replace(/HTTPACTION:1,20[0-9],/, "");
                that._readHTTPResponse(bytes, 0, cb);
            }
            that._writeCommand("AT+HTTPTERM", 100, function () { });
            return cb(err, res);
        });
    }
    _readHTTPResponse(bytes, start, cb) {
        var that = this;
        if (typeof start == 'function') {
            cb = start;
            start = 0;
        }
        var buff = '';
        var getBytes = function (start, end) {
            if (end > bytes)
                end = bytes;
            that._writeCommand("AT+HTTPREAD=" + start + "," + end, (end - start), function (err, res, raw) {
                if (raw && raw.length > 0 && raw[0] && (raw[raw.length - 2] && raw[raw.length - 2].trim() === "OK")) {
                    buff += raw[raw.length - 3];
                    if (end == bytes) {
                        that._writeCommand("AT+HTTPTERM", 100, function () { });
                        cb(null, buff);
                    }
                    else
                        getBytes(end + 1, end + 101);
                }
                else {
                    this._log("debug", 'raw failed', raw);
                    that._writeCommand("AT+HTTPTERM", 100, function () { });
                    return cb(err, buff);
                }
            });
        };
        getBytes(0, 100);
    }

    _log(level, message, ...args) {
        switch (level) {
            case "debug":
                console.debug(message, args);
                break;
            case "info":
                console.info(message, args);
                break;
            default:
                console.log(message, args);
                break;
        }
    }
}

module.exports = SIM900;