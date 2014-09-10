var events = require("events"),
    os = require("os"),
    cluster = require("cluster"),
    clutch = require("gs-clutch"),
    util = require("util"),
    EventEmitter = require("events").EventEmitter;

  
function WebServer(options) {
  WebServer.super_.call(this);
  this.processes = options.processes || os.cpus().length;
  this.clutch = [];
  this.server = [];
  this.queue = [];
  this.activeHandlers = 0;
  this.maxHandlers = options.handlers || 20;
  if(cluster.isWorker) {
    if(options.user) {
      process.setuid(options.user);
    }
    if(options.group) {
      process.setuid(options.group);
    }
  }
}

util.inherits(WebServer, EventEmitter);

WebServer.prototype.loadNextRequest = function loadNextRequest() {
  var self = this;
  if(self.queue.length > 1 && (self.maxHandlers < 1 || self.activeHandlers < self.maxHandlers)) {
    setTimeout(function() {
      if(self.queue.length > 1 && (self.maxHandlers < 1 || self.activeHandlers < self.maxHandlers)) {
        var req = self.queue.shift(), 
            res = self.queue.shift();
        if(!req.completed) {
          self.emit("handleRequest", self.queue.shift(), self.queue.shift());
        }
      }
    },0);
  }
};

WebServer.prototype.onRequestReceived = function onRequestReceived(req, res) {
  var self = this;
  req.metrics = {
    start: process.hrtime(),
  };
  console.log("request received");
  res.on("finish", function onResponseFinish() { 
    self.emit("completeRequest", req, res);
  });
  if(this.maxHandlers < 1 || this.activeHandlers >= this.maxHandlers) {
    this.queue.push(req, res);
    this.loadNextRequest(req, res);
  } else {
    this.emit("handleRequest", req, res);
  }
};

WebServer.prototype.onRequestHandled = function onRequestHandled(req, res) {
  console.log("request handled");
  req.metrics.handled = process.hrtime(req.metrics.start);
  this.emit("request", req, res);
};

WebServer.prototype.onRequestError = function onRequestError(req, res) {
  console.error("request error");
  req.metrics.error = process.hrtime(req.metrics.start);
};

WebServer.prototype.onRequestCompleted = function onRequestCompleted(req, res) {
  req.complete = true;
  req.metrics.complete = process.hrtime(req.metrics.start);
  console.log("request completed in", Math.round((req.metrics.complete[0] * 1e9 + req.metrics.complete[1]) / 1e3) / 1e3, "milliseconds");
  this.activeHandlers--;
  this.loadNextRequest();
};

WebServer.prototype.listen = function listen() {
  var evts = this.clutch, self = this;
  this.clutch = clutch({
    numWorkers: this.processes,
    nameProcess: true,
    name: process.title,
    log: true,
    forceExitTimeout: 10000
  });
  evts.forEach(function(i, e) { 
    this.clutch.on.apply(this.clutch, e); 
  });
  if(cluster.isWorker) {
    this.on("receiveRequest", this.onRequestReceived);
    this.on("handleRequest", this.onRequestHandled);
    this.on("errorRequest", this.onRequestError);
    this.on("completeRequest", this.onRequestCompleted);
    evts = this.server;
    this.server = require("http").createServer(function(req, res) {
      self.emit("receiveRequest", req, res);
    });
    this.server.listen.apply(this.server, Array.prototype.slice.call(arguments));
    evts.forEach(function(i, e) { 
      this.server.on.apply(this.server, e);
    });
    this.clutch.on("shutDown", function() {
      this.server.close();
    });
  }
}

WebServer.prototype.close = function close() {
  for(var i in cluster.workers) {
    cluster.workers[i].kill();
  }
}

WebServer.prototype.on = function on(evt, handler) {
  switch(evt) {
    case "listening":
    case "shutDown":
    case "workerStarted":
    case "workerDied":
    case "workerExit":
    case "noWorkers":
      if(this.clutch instanceof Array) {
        this.clutch.push([evt, handler]);
      } else {
        this.clutch.on(evt, handler);
      }
      break;
    case "request":
    case "connection":
    case "close":
    case "checkContinue":
    case "connect":
    case "upgrade":
    case "clientError":
      if(this.server instanceof Array) {
        this.server.push([evt, handler]);
      } else {
        this.server.on(evt, handler);
      }
      break;
    default:
      WebServer.super_.prototype.on.call(this, evt, handler);
      break;
  }
}

function RestifyServer(options) {
  RestifyServer.super_.call(this, options);
  this.module = require("restify");
  this.restify = this.module.createServer();
}

util.inherits(RestifyServer, WebServer);

RestifyServer.prototype.onRequestHandled = function onRequestHandled(req, res) {
  console.log("request handled");
  this.restify.server.emit("request", req, res);
}

function ExpressServer(options) {
  ExpressServer.super_.call(this, options);
  this.module = require("express");
  this.app = this.module();
}

util.inherits(ExpressServer, WebServer);

ExpressServer.prototype.onRequestHandled = function onRequestHandled(req, res) {
  console.log("request handled");
  this.app(req, res);
}

module.exports = {
  WebServer: WebServer,
  RestifyServer: RestifyServer
  ExpressServer: ExpressServer
}
