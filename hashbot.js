// Features to be added?
//    !lame <enable|disable> [ADDED]
//    !seen <user> [ADDED]
//    !stats me
//       Show user how many Awesomes/Snags/etc they got that day
//
// Functions to be added
//    getUidByName();
//    getNameByUid();
//    etc...
//    Bit.ly URLs in Tweets - https://github.com/tanepiper/node-bitly
//         [-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b((\/)?[-a-zA-Z0-9@:%_\+.~#\?&//=]*)?
//
// Modulize/pluginize different commands so they can be dropped into a directory and auto added to bot?
//    Something like this?  No idea yet
//    var Commands = {};
//    ... detect Plugin ...
//    Commands['lame'] = new commandLame();
//    Commands['lame'].function(data);
//
// Bugs to be fixed
//    Twitter messages > 140 chars [FIXED]
//    Timeout/disconnect from MySQL DB
//       Switch to Sequelize? http://sequelizejs.com/#installation
//
var config = require('./config').config;
var Bot = require('ttapi');
var Mysql = require('mysql');
var OAuth = require('oauth').OAuth;
var timeago = require('timeago');
var Bitly = require('bitly');
var bitly = new Bitly(config.BITLYUSER,config.BITLYAPIKEY);
var bot = new Bot(config.AUTH, config.USERID, config.ROOMID);
var conn = connect_datasource();

var usersList = {};
var djsList = {};
var moderatorsList = [];
var currentSong = null;
var currentDj = null;
var currentRoom = null;
var ruleLame = 1;
var tcpUser = 0;
var tcpSocket = null;

String.prototype.trim = function() {
	return this.replace(/^\s+|\s+$/g, '');
}

function contains(a, obj) {
	var i = a.length;
	while (i--) {
		if (a[i] === obj) {
			return true;
		}
	}
	return false;
}

function commandLame(data) {
	if (data.userid === config.MASTERID) {
		var option = data.text.slice(data.text.indexOf(' ')).trim();
		if (option.match(/enable/i)) {
			ruleLame = 1;
		}
		else if (option.match(/disable/i)) {
			ruleLame = 0;
		}
	}
}

function commandDj(data) {
	if (data.userid === config.MASTERID || contains(moderatorsList, data.userid)) {
		var option = data.text.slice(data.text.indexOf(' ')).trim();
		if (option.match(/on/i)) {
			bot.addDj();
		}
		else if (option.match(/off/i)) {
			bot.remDj();
		}
	}
}

// Currently no way exists to tell if an avatar change was successful, or if you passed a value the user can't switch to yet
function commandSkin(data) {
	if (data.userid === config.MASTERID || contains(moderatorsList, data.userid)) {
		var option = data.text.slice(data.text.indexOf(' ')).trim();
		if (option.match(/[0-9]+/)) {
	   log('!skin command given by master user:' + data.userid + 'to set option ' + option + '.');
			bot.setAvatar(option);
		}
	}
}

// Currently no way exists to tell if an avatar change was successful, or if you passed a value the user can't switch to yet
function commandRandomSkin(data) {
   var randomnumber = Math.floor(Math.random()*(config.MAXSKINVALUE+1));
	log('!rskin command given by:' + data.userid + ', switching to random option ' + randomnumber + '.');
	bot.setAvatar(randomnumber);
}

function commandSetname(data) {
	if (data.userid === config.MASTERID) {
		var option = data.text.slice(data.text.indexOf(' ')).trim();
		if (option.match(/[A-Za-z0-9-_\. ]+/)) {
			bot.modifyName(option, function setnameCb(name) {
				log(name);
			});
		}
		else {
			log('An invalid name was passed to commandSetname: ' + option);
		}
	}
}

function commandStats(data) {
	var option = data.text.slice(data.text.indexOf(' ')).trim();
	option = option.trim();
	if (option.match(/^song$/i)) {
		conn.query('SELECT * FROM songs WHERE id=? AND room_id=?', [currentSong.id, currentRoom], function selectCb(err, results, fields) {
			if (err) {
				throw err;
			}
			// Found info, lets give it
			if (results.length === 1) {
				bot.speak('This song has been played ' + results[0].playcount + ' time' + (results[0].playcount === 1 ? '': 's') + ', awesomed ' + results[0].awesomes + ' time' + (results[0].awesomes === 1 ? '': 's') + ', and snagged ' + results[0].snags + ' time' + (results[0].snags === 1 ? '': 's') + '.');
			}
		}).on('end', function() {
			// Do I want to do anything here?
		});
	}
	else if (option.match(/^dj$/i)) {
		bot.speak(currentDj.name + ' has played ' + currentDj.playCount + ' song' + (currentDj.playCount === 1 ? '': 's') + ' during this set.');
	}
	else if (option.match(/^djs$/i)) {
		var playcounts = [];
		for (var i in djsList) {
			playcounts.push(djsList[i].playCount);
		}
		bot.speak('Current song counts per DJ are ' + playcounts.join(' : '));
	}
}

function commandSeen(data) {
	var option = data.text.slice(data.text.indexOf(' ')).trim();
	var user = [];
	conn.query('SELECT users.id AS id,users.name AS name FROM users JOIN last_seen ON users.name LIKE ? AND last_seen.user_id=users.id AND last_seen.room_id=?', ['%' + option + '%', currentRoom], function selectCb(err, results, fields) {
		if (err) {
			throw err;
		}
		if (results.length === 0) {
			bot.speak('I have never seen anyone with a name containing that string.');
		}
		else if (results.length === 1) {
			user = results[0];
			if (usersList.hasOwnProperty(user.id)) {
				if (user.name === usersList[user.id].name) {
					bot.speak('What are you, NEW?! ' + user.name + ' is currently in the room!');
				}
				else {
					bot.speak(user.name + ' is currently in the room as ' + usersList[user.id].name);
				}
			}
			else {
				var sub_conn = connect_datasource();
				sub_conn.query('SELECT timestamp FROM last_seen WHERE user_id=?', [user.id], function selectCb(err, results, fields) {
					if (err) {
						throw err;
					}
					if (results.length === 1) {
						bot.speak('I last saw ' + user.name + ' ' + timeago(results[0].timestamp) + '.');
					}
				}).on('end', function() {
					sub_conn.destroy();
				});
			}
		}
		else if (results.length > 6) {
			bot.speak('There were too many people who matched that, please be more specific.');
		}
		else if (results.length > 1 && results.length <= 6) {
			var users_array = [];
			for (i = 0; i < results.length - 1; i++) {
				users_array.push(results[i].name);
			}
			var users_string = users_array.join(', ');
			users_string += ' or ' + results[results.length - 1].name;
			bot.speak('I am sorry, did you mean ' + users_string + '?');
		}
	}).on('end', function() {
		// Do I want to do anything here?
	});
}

function commandRules(data, user) {
   if (user) {
		bot.speak(user.name + ', I haven\'t seen you in this channel before, here are the rules: ' + config.CHANNELRULES);
	}
	else {
   		bot.speak('Channel rules:  ' + config.CHANNELRULES);
	}
}

function commandTweet(data) {
	if (data.userid === config.MASTERID || contains(moderatorsList, data.userid)) {
		var option = data.text.slice(data.text.indexOf(' ')).trim();
		if (option.match(/^song$/i)) {
			var tag = '#nowplaying';
			var tweet = currentDj.name + ' is playing: ' + currentSong.artist + ' - ' + currentSong.song;
			if (tweet.length + (tag.length + 1) > 140) {
				tweet = tweet.substring(0, (tweet.length - (tweet.length + (tag.length + 1) - 140)));
			}
			sendTweet(tweet + ' ' + tag);
		}
		else {
			sendTweet(option);
		}
	}
}

function sendTweet(data) {
	var url_regex = /[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b((\/)?[-a-zA-Z0-9@:%_\+.~#\?&//=]*)?/;

	if (result = data.match(url_regex)) {
		var long_url = result[0];
		log('Found URL: '+long_url);
		bitly.shorten(long_url, function(err, response) {
			if (err) throw err;
			var short_url = response.data.url
			data = data.replace(long_url,short_url);
			bot.speak('I shortened your tweet to: '+data);
		});
	}

	if (data.length > 140) {
		data = data.substring(0, 140);
	}
	oAuth.post("http://api.twitter.com/1/statuses/update.json", config.TWITTERACCESSTOKEN, config.TWITTERACCESSTOKENSECRET, {
		"status": data
	},
	function(error, data) {
		if (error) {
			console.log(require('sys').inspect(error));
		}
		else {
			// console.log(data);
		}
	});
}

function log(data) {
	var timestamp = new Date();
	console.log(timestamp, data);
}

function connect_datasource() {
	var db = Mysql.createClient({
		user: config.MYSQL_USER,
		password: config.MYSQL_PASS,
	});
	db.useDatabase(config.MYSQL_DB, function(err) {
		if (err) {
			throw err;
		}
	});
	return db;
}

function updateSongVotes(up, down) {
	currentSong.TotalAwesomes += up;
	currentSong.TotalLames += down;
}

function saveSong() {
	log('Updating Database with Song Information for: ' + currentSong.id);
	conn.query('REPLACE INTO songs (id,room_id,awesomes,lames,snags,playcount,starttime,currentawesomes,currentlames) ' + 'VALUES (?,?,?,?,?,?,?,?,?)', [currentSong.id, currentRoom, currentSong.TotalAwesomes, currentSong.TotalLames, currentSong.Snagged, currentSong.PlayCount, currentSong.StartTime, currentSong.CurrentAwesomes, currentSong.CurrentLames]).on('end', function() {
		// Do I want to do anything here?
	});
}

function updateLastSeen(data) {
	if (currentRoom === null || data.userid === config.USERID) {
		return;
	}
	log('Updating user last seen for: ' + data.name);
	conn.query('REPLACE INTO last_seen (user_id,room_id,timestamp) VALUES (?,?,?)', [
	data.userid, currentRoom, new Date()]).on('end', function() {
		// Do I want to do anything here?
	});
	conn.query('REPLACE INTO users (id,name) VALUES (?,?)', [
	data.userid, data.name]).on('end', function() {
		// Do I want to do anything here?
	});
}

function newSong(data) {
	// Grab the new song info
	var current_song = data.current_song;

	var song_id = current_song._id;

	var song = current_song.metadata;
	song.lastPlayed = new Date();
	song.id = song_id;
	song.TotalAwesomes = 0;
	song.TotalLames = 0;
	song.CurrentAwesomes = data.upvotes;
	song.CurrentLames = data.downvotes;
	song.Snagged = 0;
	song.CurrentSnags = 0;
	song.PlayCount = 1;
	song.StartTime = current_song.starttime;
	log('Set Default Song Information: ' + song_id);
	// Do we already have info on this song?  Lets try to pull it up
	conn.query('SELECT * FROM songs WHERE id=? AND room_id=?', [song_id, currentRoom], function selectCb(err, results, fields) {
		if (err) {
			throw err;
		}
		// Found info, lets add it to the current song info
		if (results.length === 1) {
			song.TotalAwesomes = results[0].awesomes;
			song.TotalLames = results[0].lames;
			song.Snagged = results[0].snags;
			song.PlayCount = results[0].playcount;
			if (song.StartTime == results[0].starttime) {
				// Catch up on any missed votes while gone
				song.TotalAwesomes += song.CurrentAwesomes - results[0].currentawesomes;
				song.TotalLames += song.CurrentLames - results[0].currentlames;
			}
			else {
				// Start time doesn't match, so this isn't the same occurrence of what is in the DB, lets increment the playcount
				song.PlayCount += 1;
			}
			log('Updated Song Information from Database: ' + song_id);
		}
	}).on('end', function() {
		currentSong = song;
		saveSong();
	});
	var dj_id = data.current_dj;
	log(usersList[dj_id].name + ' started playing: ' + song.artist + ' - ' + song.song);
	if (tcpUser) {
		tcpSocket.write('>> ' + usersList[dj_id].name + ' started playing: ' + song.artist + ' - ' + song.song + '\n');
	}
	djsList[dj_id].playCount += 1;
	currentDj = djsList[dj_id];

	upvoteCheck(data);
}

function endSong(data) {
	if (data.room === null) {
		return;
	}
	saveSong();
	bot.speak(currentSong.artist + ' - ' + currentSong.song + ' was awesomed ' + currentSong.CurrentAwesomes + ' time' + (currentSong.CurrentAwesomes === 1 ? '': 's') + ', and snagged ' + currentSong.CurrentSnags + ' time' + (currentSong.CurrentSnags === 1 ? '': 's') + '.');
}

function upvoteCheck(data) {
	if (currentSong === null) {
		return;
	}
	for (var i = 0; i < data.votelog.length; i++) {
		if (data.votelog[i][0] === config.USERID) {
			log('I already voted for this song.  No need to continue.');
			return;
		}
	}
	var votesNeeded = (data.listeners - 1) / 2;
	if (data.upvotes > votesNeeded) {
		bot.vote('up');
		log('I voted up song ' + currentSong.id + ': ' + currentSong.artist + ' - ' + currentSong.song + '.');
	}
	else {
		log('There are not enough votes for me to awesome this song yet.  Have ' + data.upvotes + ' but need more than ' + votesNeeded + '.');
	}
}

// Provide for the bot to say random stuff on occasion
function randomComment() {
	// Random number between 0 and 99
	var commentNum = Math.floor(Math.random()*100)
   log('Random Comment #' + commentNum)
	if (commentNum < 3) {
		bot.speak('On on!');
	}
	else if (commentNum == 4) {
		bot.speak('Boob Check!');
	}
	else if (commentNum == 5) {
		bot.speak('Beer Near!');
	}
	else if (commentNum == 6) {
	  dateToday = new Date();
	  if (dateToday.getDay() == 1) {
			bot.speak('Today is Monday! Monday is a wanking day! Is everybody happy?');
	  	}
	  else if (dateToday.getDay() == 2) {
			bot.speak('Today is Tuesday! Tuesday is two-finger day! Is everybody happy?');
	  	}
	  else if (dateToday.getDay() == 3) {
			bot.speak('Today is Wednesday! Wednesday is a hashing day! Is everybody happy?');
	  	}
	  else if (dateToday.getDay() == 4) {
			bot.speak('Today is Thursday! Thursday is a http://coedmagazine.files.wordpress.com/2011/03/girl-obscene-gesture-tongue-between-fingers-vikavalter-vetta.jpg day! Is everybody happy?');
	  	}
	  else if (dateToday.getDay() == 5) {
			bot.speak('Today is Friday! Friday is a fucking day! Is everybody happy?');
	  	}
	  else if (dateToday.getDay() == 6) {
			bot.speak('Today is Saturday! Saturday is a drinking day! Is everybody happy?');
	  	}
	  else if (dateToday.getDay() == 0) {
			bot.speak('Today is Sunday! Sunday is a day of rest. Is everybody happy?');
	  	}
	  } // End if (commentNum == 6)
}

log("STARTING UP!");

oAuth = new OAuth("https://api.twitter.com/oauth/request_token", "https://api.twitter.com/oauth/access_token", config.TWITTERCONSUMERKEY, config.TWITTERCONSUMERSECRET, "1.0A", null, "HMAC-SHA1");

// Set up a small interface to allow me to interact with users through the bot
bot.tcpListen(8080, '127.0.0.1');

// Runs once after bot initializes
bot.on('ready', function(data) {
	log('Setting default skin to ' + config.DEFAULTSKIN + '.');
	bot.setAvatar(config.DEFAULTSKIN);
	});

bot.on('tcpConnect', function(socket) {
	tcpUser = 1;
	tcpSocket = socket;
});

bot.on('tcpMessage', function(socket, msg) {
	log('Received the following TCP Message: ' + msg);
	if (msg.match(/^join [0-9A-Za-z]*/)) {
		var command = msg.split(" ");
		bot.roomRegister(command[1]);
		socket.write('>> Joining new room.\n');
	}
	else if (msg.match(/^playlist info$/)) {
		bot.playlistAll(function(data) {
			for (var i = 0; i < data.list.length; i++) {
				var song = data.list[i];
				log(song);
			}
		});
	}
	else if (msg.match(/^say/)) {
		var text = msg.match(/^say (.*)$/);
		bot.speak(text[1]);
	}
	else {
		socket.write('>> Unknown command: ' + msg + '\n');
	}
});

bot.on('tcpEnd', function(socket) {
	tcpUser = 0;
	tcpSocket = null;
});

bot.on('roomChanged', function(data) {
	// Reset the users list
	usersList = {};
	djsList = {};

	currentRoom = data.room.roomid;

	log('I joined a new room - http://turntable.fm/' + data.room.shortcut);
	// Build the users list
	for (var i = 0; i < data.users.length; i++) {
		var user = data.users[i];
		user.lastActivity = new Date();
		usersList[user.userid] = user;
	}
	for (var i = 0; i < data.room.metadata.djs.length; i++) {
		djsList[data.room.metadata.djs[i]] = usersList[data.room.metadata.djs[i]];
		djsList[data.room.metadata.djs[i]].playCount = 0;
	}

	moderatorsList = data.room.metadata.moderator_id;

	// Default is don't allow laming
	if (currentRoom === config.ROOMID) {
		ruleLame = 1;
	}
	else {
		ruleLame = 0;
	}

	// Don't continue if there isn't a song playing
	if (data.room.metadata.current_song !== null) {
		newSong(data.room.metadata);
	}
});

// Someone entered the room, add entry to users list.
bot.on('registered', function(data) {
	var user = data.user[0];
	user.lastActivity = new Date();
	usersList[user.userid] = user;
	log(user.name + ' entered the room.');
   // Determine if we've seen this user before
//   	var option = data.text.split(" ", 2)[1];
   if (user.name != config.MYNAME) {
		var conn = connect_datasource();
//		conn.query('SELECT users.id AS id,users.name AS name FROM users JOIN last_seen ON users.name LIKE ? AND last_seen.user_id=users.id AND last_seen.room_id=?', ['%' + option + '%', currentRoom], function selectCb(err, results, fields) {
		conn.query('SELECT users.id AS id,users.name AS name FROM users JOIN last_seen ON users.name LIKE ? AND last_seen.user_id=users.id AND last_seen.room_id=?', ['%%', currentRoom], function selectCb(err, results, fields) {
			if (err) {
				throw err;
			}
			if (results.length == 0) {
				log('I have never seen user ' + user.name + ' in this room before, displaying rules:');
				commandRules(data, user);
			}
		}).on('end', function() {
			conn.destroy();
		});
	}
	updateLastSeen(user);
});

// Someone left, remove entry from the users list.
bot.on('deregistered', function(data) {
	var user = data.user[0];
	delete usersList[user.userid];
	log(user.name + ' left the room.');
	updateLastSeen(user);
});

bot.on('speak', function(data) {
	// Create a regex string so we can match on our own name
	var mynameRegex = new RegExp(config.MYNAME, "ig");
	
	usersList[data.userid].lastActivity = new Date();

	// Check so we don't match on things we said ourselves	
	if (data.userid == config.USERID) {
	   return false;		
	}
	
	// Otherwise, log what other people say in the channel.
	log(data.name + ' said: ' + data.text);
	if (tcpUser) {
		tcpSocket.write('>> ' + data.name + ' said: ' + data.text + '\n');
	}

   // Check for commands given in the channel
	if (data.text.match(/^!lame [A-Za-z]+/i)) {
		commandLame(data);
	}
	else if (data.text.match(/^!skin [A-Za-z0-9]+/i)) {
		commandSkin(data);
	}
	else if (data.text.match(/^!rskin.*/i)) {
		commandRandomSkin(data);
	}
	else if (data.text.match(/^!name [A-Za-z0-9]+/i)) {
		commandSetname(data);
	}
	else if (data.text.match(/^!stats [A-Za-z0-9]+/i)) {
		commandStats(data);
	}
	else if (data.text.match(/^!seen .*/i)) {
		commandSeen(data);
	}
	else if (data.text.match(/^!dj .*/i)) {
		commandDj(data);
	}
	else if (data.text.match(/^!tweet .*/i)) {
		commandTweet(data);
	}
	else if (data.text.match(/^!rules.*/i)) {
		commandRules(data);
	}
   // Matching for various non-command things said in the channel.
//	else if (data.text.match(/On on/ig)) {
//	    bot.speak('On on!');
//	 }
   // Matching for non-command things said directly to us
	else if (data.text.match(mynameRegex)) {
	  if (data.text.match(/^Hello.*/i)) {
	    bot.speak('Hello ' + data.name + '!');
	  }
	  else if (data.text.match(/^Hey.*/i)) {
	    bot.speak('Hey ' + data.name + '!');
	  }
	  else if (data.text.match(/^Hi.*/i)) {
	    bot.speak('Hi ' + data.name + '!');
	  }
	  else if (data.text.match(/are you a bot.*/i)) {
	    bot.speak('Yep, I am.  Dumb as toast, and almost as bright!');
	  }
	  else {
	    bot.speak('Huh?');
	  }
	}
	
	return true;
});

bot.on('update_votes', function(data) {
	log('update_votes triggered.');
	var votelog = data.room.metadata.votelog;
	for (var i = 0; i < votelog.length; i++) {
	log('User ' + votelog[i][0] + ' voted ' + votelog[i][1] + '.');
		var userid = votelog[i][0];
		if (userid !== '') {
			usersList[userid].lastActivity = new Date();
			log(usersList[userid].name + ' voted ' + votelog[i][1] + ' for the song: ' + currentSong.artist + ' - ' + currentSong.song + '.');
		}
		if (votelog[i][1] === "down" && ruleLame) {
			if (userid !== '') {
				bot.speak('Hey! No laming/thumbs downing, ' + usersList[userid].name + '!');
			}
			else {
				bot.speak('Hey! No laming! Follow the rules! (type !rules)');
			}
		}
		updateSongVotes(data.room.metadata.upvotes - currentSong.CurrentAwesomes, data.room.metadata.downvotes - currentSong.CurrentLames);
		currentSong.CurrentAwesomes = data.room.metadata.upvotes;
		currentSong.CurrentLames = data.room.metadata.downvotes;
		log('This song now has ' + currentSong.CurrentAwesomes + ' awesomes and ' + currentSong.CurrentLames + ' lames.');
		saveSong();

		upvoteCheck(data.room.metadata);

		if (data.room.metadata.upvotes / (data.room.metadata.listeners - 1) * 100 >= config.MINTOADDTOPL && data.room.metadata.listeners > 6) {
			log('Adding ' + currentSong.artist + ' - ' + currentSong.song + ' to my playlist.');
			bot.snag();
			bot.playlistAdd(currentSong.id);
		}
	}
});

// Someone added the surrent song to their playlist.
bot.on('snagged', function(data) {
	var userid = data.userid;
	usersList[userid].lastActivity = new Date();
	log(usersList[userid].name + ' snagged the song ' + currentSong.artist + ' - ' + currentSong.song);
	currentSong.Snagged += 1;
	currentSong.CurrentSnags += 1;
	log('This song has been snagged ' + currentSong.Snagged + ' time' + (currentSong.Snagged === 1 ? '.': 's.'));
	saveSong();
});

// Someone stepped up to DJ Booth
bot.on('add_dj', function(data) {
	var user = data.user[0];
	user.playCount = 0;
	djsList[user.userid] = user;
	usersList[user.userid].lastActivity = new Date();
	log(user.name + ' has become a DJ.');
});

// Someone stepped down from DJ Booth
bot.on('rem_dj', function(data) {
	var user = data.user[0];
	delete djsList[user.userid];
	usersList[user.userid].lastActivity = new Date();
	log(user.name + ' has stopped DJing.');
});

// Track song information
bot.on('newsong', function(data) {
	// Retrieve current playing song info
	newSong(data.room.metadata);
});

// Song ended!
bot.on('endsong', function(data) {
	// Save the song information
	log('The current song just finished playing.');
	endSong(data);
});

// What to do when no song is playing?
bot.on('nosong', function(data) {
	// Figure this out later, just log the data for now
	log('No song is playing, zogads!', data);
});
