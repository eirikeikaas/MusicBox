// REQUIRE ////////////////////////////////////////
var app = require('express')()
  , server = require('http').createServer(app)
  , io = require('socket.io').listen(server);
var path = require('path');
var gm = require('gm');
var fs = require('fs');
var request = require('request');
var Mopidy = require("mopidy").Mopidy;

// SERVER INIT ////////////////////////////////////
server.listen(9090);

// VARIABLES //////////////////////////////////////
var _queue = {};
var _current = {};
var _auth = {'eirik': {key: "c79a08444243cae99223bee17037ee0b5b8c9d9d"}, 'filip': {key: "agnesisenga"}};

// HELPERS ////////////////////////////////////////
Array.prototype.contains = function(k, callback){
    var self = this;
    return (function check(i) {
        if (i >= self.length) {
            return callback(false);
        }

        if (self[i] === k) {
            return callback(true);
        }

        return process.nextTick(check.bind(null, i+1));
    }(0));
};
Object.size = function(obj){
    var size = 0, key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) size++;
    }
    return size;
};

var updateQueue = function(_track, _votes, _voter){
	if(_queue[_track.uri] == undefined){
		io.sockets.emit('log', {level: 'ok', message: 'Added '+_track.name, aspect: 'mopidy'});
		_queue[_track.uri] = {track: _track, votes: _votes, voters: [_voter]};
		
		mopidy.tracklist.getLength().then(function(length){
			if(length == 0){
				mopidy.tracklist.add([_track]);
				mopidy.playback.play();
			}else{
				mopidy.tracklist.add([_track]);
			}
		});
		
		var tl = returnTracklist();
		io.sockets.emit('list', {tracks: tl[0], votes: tl[1]});
	}else{
		_queue[_track.uri].voters.contains(_voter, function(found){
			if(!found){
				io.sockets.emit('log', {level: 'ok', message: 'Voted '+_track.name, aspect: 'mopidy'});
				_queue[_track.uri].votes += _votes;
				_queue[_track.uri].voters.push(_voter); 
				
				var tl = returnTracklist();
				
				for(var i=1;i<tl[0].length;i++){
					mopidy.tracklist.index(tl[0][i]).then(function(index){
						mopidy.tracklist.move(index, 1, i);
					});
				}
				
				io.sockets.emit('list', {tracks: tl[0], votes: tl[1]});
			}else{
				// Do nothing
			}
		});
	}
	
	mopidy.tracklist.getLength().then(function(length){
		io.sockets.emit('log', {level: 'log', message: 'Tracklist: '+length+' Queuelist: '+size(_queue)});
	});
};
var returnTracklist = function(){
	var trklist = [];
	var sortlist = [];
	var votelist = {};
	
	for(key in _queue){
		sortlist.push(_queue[key]);
		votelist[key] = {votes: _queue[key].votes, voters: _queue[key].voters};
	}
	
	sortlist = sortlist.slice(1);
	
	sortlist.sort(function(a, b){
		return b.votes - a.votes;
	});
	
	for(var i=0;i<sortlist.length;i++){
		trklist.push(sortlist[i].track);
	}
	
	console.log(_queue);
	
	return [trklist, votelist];
};
var download = function(uri, filename){
	request.head(uri, function(err, res, body){
		var r = request(uri).pipe(fs.createWriteStream(filename));
	});
};
var working = '';

var mopidy = new Mopidy({
    webSocketUrl: "ws://localhost:6680/mopidy/ws/"
});

var coverart = function(artist, album, callback){
	console.log('Runninnnnng');
	converted = '';
	cover = '';
	json = '';
	
	url = 'http://ws.audioscrobbler.com/2.0/?method=album.getinfo&api_key=64d084ab23004abe9811c2064fbc960e&artist='+encodeURIComponent(artist)+'&album='+encodeURIComponent(album)+'&format=json';
	
	console.log('Request cover for '+artist+' '+album);
	if(typeof callback === 'function'){
		console.log("Request does have callback");
	}
	
	request(url, function(error, response, body){
		json = JSON.parse(body);
		if(json.album.image != undefined){
			if(json.album.image[4]['#text'] != ""){
				cover = json.album.image[4]['#text'];
			}else if(json.album.image[3]['#text'] != ""){
				cover = json.album.image[3]['#text'];
			}else if(json.album.image[2]['#text'] != ""){
				cover = json.album.image[2]['#text'];
			}else if(json.album.image[1]['#text'] != ""){
				cover = json.album.image[1]['#text'];
			}else if(json.album.image[0]['#text'] != ""){
				cover = json.album.image[0]['#text'];
			}else{
				console.log('end request, bad response');
				out = {'success': false};
				if(typeof callback === 'function'){
					return out;
				}else{
					 callback(out);
				}
			}
		}else{
			console.log('end request, bad response');
			out = {'success': false};
			if(typeof callback === 'function'){
					return out;
				}else{
					 callback(out);
				}
		}
		
		fs.exists('cover/'+path.basename(cover), function( exists ) {
			if(!exists && working != url){
				if(working != url){
					console.log('Handling new blurring request');
				}
				working = url;
				download(cover, 'cache/'+path.basename(cover));
				setTimeout(function(){
					
					// Sample image
					gm('cache/'+path.basename(cover)).sample('1x1').write('sample/'+path.basename(cover), function(err){
						if (!err) {
							console.log('Completed sample request for '+artist+' '+album);
						}else{
							console.log(err);
						}
					});
					
					// Blur image
					gm('cache/'+path.basename(cover)).blur(7,3).write('cover/'+path.basename(cover), function(err){
						if (!err) {
							console.log('Completed blur request for '+artist+' '+album);
							out = {'success': true, 'file': 'cover/'+path.basename(cover), 'sample': 'sample/'+path.basename(cover)};
							if(typeof callback === 'function'){
					return out;
				}else{
					 callback(out);
				}
						}else{
							console.log(err);
							out = {'success': false};
							if(typeof callback === 'function'){
					return out;
				}else{
					 callback(out);
				}
						}
					});
				}, 2000);
			}else{
				console.log('Loaded from cache or working');
				out = {'success': true, 'file': 'cover/'+path.basename(cover), 'sample': 'sample/'+path.basename(cover)};
				if(typeof callback === 'function'){
					return out;
				}else{
					 return callback(out);
				}
			}
		});
	});

}


// WEBSOCKET AUTH /////////////////////////////////
io.of('/system').authorization(function (handshakeData, callback) {
	console.log("HSD", handshakeData);
	io.sockets.emit('log', {level: 'log', message: "Incoming auth request", aspect: 'systemio'});
	if(_auth[handshakeData.query.authid] != undefined){
		io.sockets.emit('log', {level: 'log', message: "Handling auth request for user "+handshakeData.query.authid, aspect: 'mopidy'});
		callback(null, (_auth[handshakeData.query.authid].key == handshakeData.query.authkey));
	}else{
		callback(null, false);
	}
}).on('connection', function (socket) {
  socket.in('system').emit('ident', {});
  
  socket.on("command", function(data){
	 if(data.command != undefined){
		 var cmdx = data.command.split(":");
		 
		 console.log(data, cmdx);
		 switch(cmdx[0]){
			 case "playback":
			 	switch(cmdx[1]){
					case "play":
						io.sockets.emit('log', {level: 'log', message: "playback:play has been issued", aspect: 'mopidy'});
						mopidy.playback.play();
						break;
					case "pause":
						io.sockets.emit('log', {level: 'log', message: "playback:pause has been issued", aspect: 'mopidy'});
						mopidy.playback.pause();
						break;
					case "stop":
						io.sockets.emit('log', {level: 'log', message: "playback:stop has been issued", aspect: 'mopidy'});
						mopidy.playback.stop();
						break;
					case "prev":
						io.sockets.emit('log', {level: 'log', message: "playback:prev has been issued", aspect: 'mopidy'});
						mopidy.playback.previous();
						break;
					case "next":
						io.sockets.emit('log', {level: 'log', message: "playback:next has been issued", aspect: 'mopidy'});
						mopidy.playback.next();
						break;
				}
			 	break;
			 case "system":
			 	switch(cmdx[1]){
					case "clear":
						_queue = {};
						io.sockets.emit('log', {level: 'log', message: "Clearing tracklist and queue", aspect: 'mopidy'});
						mopidy.tracklist.clear();
						var tl = returnTracklist();
						io.sockets.emit('list', {tracks: tl[0], votes: tl[1]});
						break;
				}
			 	break;
			 case "volume":
			 	mopidy.playback.setVolume(parseInt(data.level));
			 	break;
			 default:
			 	io.sockets.emit('log', {level: 'error', message: "Unhandled system command", aspect: 'systemio'});
		 }
	 } 
  });
});

// WEBSOCKET //////////////////////////////////////
io.on('connection', function (socket) {

	var tl = returnTracklist();
	socket.emit('list', {tracks: tl[0], votes: tl[1]});
	
	socket.on('update', function (data) {
    console.log("UPDATE");
    var tl = returnTracklist();
    socket.emit('list', {tracks: tl[0], votes: tl[1]});
  });
	socket.on('vote', function (data) {
		console.log("VOTE");
		updateQueue(data.track, 1, socket.id);
	});
	socket.on('queue', function (data) {
		console.log("QUEUE");
		updateQueue(data.track, 1, socket.id);
	});
	socket.on('system', function (data) {
		console.log("SYSTEM", data.command);
		switch(data.command){
			case 'clear':
				_queue = {};
				var tl = returnTracklist();
				socket.emit('list', {tracks: tl[0], votes: tl[1]});
				break;
		}
	});
	socket.on('coverart', function (data) {
		coverart(data.artist, data.album, function(result){
			io.sockets.emit('cover', result);
		});
	});
});

mopidy.on('event:trackPlaybackEnded', function(data){
	io.sockets.emit('log', {level: 'log', message: 'Playback ended', aspect: 'mopidy'});
	console.log("Deleting track "+data.tl_track.track.name);
	
	mopidy.tracklist.getTracks().then(function(tracks){
		for(var i=0;i<tracks.length;i++){
			console.log(tracks[i]);
		}
	});
	
	mopidy.tracklist.remove({tlid: data.tl_track.track.tlid, uri: data.tl_track.track.uri}).then(function(tracks){
		console.log("REMOVED ", tracks);
	});
	io.sockets.emit('log', {level: 'log', message: 'Removed '+data.tl_track.track.name, aspect: 'mopidy'});
	//console.log("PREDEL", _queue);
	delete _queue[data.tl_track.track.uri];
	//console.log("AFTDEL", _queue);
	
	mopidy.tracklist.getTracks().then(function(tracks){
		for(var i=0;i<tracks.length;i++){
			console.log(tracks[i]);
		}
	});
	
	var tl = returnTracklist();
	io.sockets.emit('list', {tracks: tl[0], votes: tl[1]});
});
	
mopidy.on('event:playbackStateChanged', function(data){
	io.sockets.emit('log', {level: 'log', message: 'fetching cover art', aspect: 'mopidy'});
	mopidy.playback.getCurrentTrack().then(function(track){
		if(track){
			console.log("Got track, finding cover art");

			/*
coverart(track.artist[0].name, track.album.name, function(result){
				io.sockets.emit('cover', result);
			});
*/
		}
	});
});

// HTTP ///////////////////////////////////////////
app.use (function(req, res, next) {
	res.header("Access-Control-Allow-Origin", "*");
    var data = '';
    req.setEncoding('utf8');
    req.on('data', function(chunk) { 
       data += chunk;
    });
    req.on('end', function() {
        req.rawBody = data;
        next()
    });
});
app.get('/', function(req, res){
	res.send('');
});
app.get('/album/:artist/:album', function(req, res){
	coverart(req.params.artist, req.params.album, function(result){
		res.write(JSON.stringify(cover));
		res.send();
	});
});
app.post('/queue/:uri', function(req, res){
	var track = JSON.parse(new Buffer(req.rawBody, 'base64').toString());
	updateQueue(track, 1);
	res.write(JSON.stringify({success: true}));
	res.send();
});
app.post('/vote/:uri', function(req, res){
	var track = JSON.parse(new Buffer(req.rawBody, 'base64').toString());
	updateQueue(track, 1);
	res.write(JSON.stringify({success: true}));
	res.send();
});
app.get('/list', function(req, res){
	res.write(JSON.stringify({success: true, queue: parseQueue}));
	res.send();
});