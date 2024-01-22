const { app, BrowserWindow } = require('electron');
const url = require('url');
const path = require('path');
const express = require("express");
const session = require("express-session");
const pool = require("./config/database");
const axios = require("axios");
const multer = require("multer");
const { closeSync } = require('fs');
const { constrainedMemory } = require('process');

let domain = "localhost:5000";
const PORT = process.env.PORT || 3000;


// SETTING UP EXPRESS
const expressApp = express();
expressApp.set('view engine', 'ejs');
expressApp.set('views', __dirname + '/views');
expressApp.use(express.static(path.join(__dirname, '/assets/css')));
expressApp.use(express.json());
expressApp.use(express.urlencoded({ extended: false }));
expressApp.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

const server = expressApp.listen(PORT, () => console.log(`server on port ${PORT}`))
var upload = multer();
const io = require('socket.io')(server)

let socketsConnected = new Set()
io.on('connection', onConnected)


function onConnected(socket) {

    socket.on('join-guild', (guildId) => {
        socket.join(`guild:${guildId}`);
    });

    socket.on('private-message', (data) => {
        const { senderId, receiverId, message } = data;
        const timestamp = new Date().toISOString({ timeZone: 'Europe/Istanbul' });

        axios.post("http://localhost:5000/api/channels/send-dm-message", {
            sender_id: senderId,
            receiver_id: receiverId,
            message: message,
            timestamp: timestamp
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.API_TOKEN}`
            }
        })
            .then((response) => {
                if (response.data.success === 1) {
                    const receiverSocket = Array.from(socketsConnected).find(
                        (socketId) => io.sockets.sockets[socketId].request.user.id === receiverId
                    );

                    if (receiverSocket) {
                        io.emit('private-message', { ...data, timestamp });
                    }
                }
            })
            .catch((err) => {
                console.log(err);
            });
    });

    socket.on('guild-message', (data) => {
        const { userId, guildId } = data;
        const timestamp = new Date().toISOString({ timeZone: 'Europe/Istanbul' });
        axios.post("http://localhost:5000/api/channels/send-message", {
            data: {
                user_id: data.user_id,
                guild_id: data.guild_id,
                channel_id: data.channel_id,
                message: data.message,
                timestamp: timestamp
            }
        }).then((response) => {
            if (response.data.success == 1) {
                // Find the socket of the user who sent the message
                const senderSocket = Array.from(socketsConnected).find(
                    (socketId) => io.sockets.sockets[socketId].request.user.id === userId
                );

                // Emit the group message to all connected clients
                io.to(`guild:${guildId}`).emit('guild-message', data);
            }
        }).catch((err) => {
            console.log(err);
        });
    });


    socket.on('disconnect', () => {
        socketsConnected.delete(socket.id);
    });

}


// GET REQUESTS
expressApp.get("/", checkAuthenticated, (req, res) => {
    res.redirect("/channels");
});

expressApp.get("/login", checkNotAuthenticated, (req, res) => {
    res.render("login");
});

expressApp.get("/register", checkNotAuthenticated, (req, res) => {
    res.render("register");
});

expressApp.get("/search-user", checkAuthenticated, (req, res) => {
    const { username } = req.query;

    pool.query(
        `SELECT * FROM users WHERE username LIKE ?`,
        [username + "%"],
        (err, results) => {
            if (err) {
                throw err;
            }

            results.forEach((user) => {
                delete user.password;
            });

            res.json(results); // JSON formatında sonuçları gönder
        }
    );
});

expressApp.get("/channels", checkAuthenticated, (req, res) => {
    axios.get("http://localhost:5000/api/user/user-in-guilds", {
        headers: {
            'Authorization': `Bearer ${req.session.user.token}`
        },
        data: {
            user_id: req.session.user.id
        }
    }).then((response) => {
        res.render("ChannelsUser", {
            user: req.session.user,
            guilds: response.data.data,
            messages: null,
            receiver: null
        });
    }).catch((err) => {
        console.log(err);
    });
});

expressApp.get("/channels/@me/:receiverId", checkAuthenticated, (req, res) => {
    axios.get("http://localhost:5000/api/user/dm-messages", {
        headers: {
            'Authorization': `Bearer ${req.session.user.token}`
        },
        data: {
            sender_id: req.session.user.id,
            receiver_id: req.params.receiverId
        }
    }).then((response) => {
        res.render("ChannelsUser", {
            user: req.session.user,
            guilds: response.data.data.members,
            messages: response.data.data.messages,
            receiver: response.data.data.receiver
        });
    }).catch((err) => {
        console.log(err);
    });
});

expressApp.get("/channels/:guildId/:channelId", checkAuthenticated, (req, res) => {
    axios.get("http://localhost:5000/api/guilds/get-guild", {
        headers: {
            'Authorization': `Bearer ${req.session.user.token}`
        },
        data: {
            guild_id: req.params.guildId,
            channel_id: req.params.channelId,
            user_id: req.session.user.id
        }
    }).then((response) => {
        if (response.data.success == 2) return res.redirect(`/channels/${req.params.guildId}/${response.data.data}`);
        if (response.data.success == 3) return res.render("404Guild", {
            user: req.session.user,
            guilds: response.data.data
        });
        console.log(response.data.data.messages)
        res.render("ChannelsGuild", {
            user: req.session.user,
            guild: response.data.data.guild,
            channels: response.data.data.channels,
            selectedByUser: true,
            messages: response.data.data.messages,
            members: response.data.data.members,
            guilds: response.data.data.guilds,
            users: response.data.data.users,
            memberUsers: response.data.data.memberUsers
        });
    }).catch((err) => {
        console.log(err);
    });
});

expressApp.get("/channels/:guildId", checkAuthenticated, (req, res) => {
    axios.get("http://localhost:5000/api/guilds/get-guild", {
        headers: {
            'Authorization': `Bearer ${req.session.user.token}`
        },
        data: {
            guild_id: req.params.guildId,
            user_id: req.session.user.id
        }
    }).then((response) => {
        if (response.data.success == 2) return res.redirect(`/channels/${req.params.guildId}/${response.data.data}`);
        if (response.data.success == 3) return res.render("404Guild", {
            user: req.session.user,
            guilds: response.data.data
        });

        res.render("ChannelsGuild", {
            user: req.session.user,
            guild: response.data.data.guild,
            channels: response.data.data.channels,
            selectedByUser: true,
            messages: null,
            members: response.data.data.members,
            guilds: response.data.data.guilds,
            users: response.data.data.users,
            memberUsers: response.data.data.memberUsers
        });
    }).catch((err) => {
        console.log(err);
    });
});

//POST REQUESTS
expressApp.post("/register", upload.single("avatar"), (req, res) => {
    const { username, email, password } = req.body;

    const avatar = req.file.buffer.toString('base64');

    axios.post("http://localhost:5000/api/user/register", {
        username,
        email,
        password,
        avatar
    }).then((response) => {
        if (response.data.success == 0) {
            res.render("register", { message: response.data.message });
        } else if (response.data.success == 1) {
            res.redirect("/")
        }
    }).catch((err) => {
        console.log(err);
    });
});

expressApp.post("/login", (req, res) => {
    const { email, password } = req.body;
    axios.post("http://localhost:5000/api/user/login", {
        email,
        password
    }).then(function (response) {
        if (response.data.success == 0) {
            res.render("login", { message: response.data.message });
        } else if (response.data.success == 1) {
            req.session.isAuthenticated = true;
            req.session.user = response.data.data[0];
            res.redirect("/");
        }
    }).catch((err) => {
        console.log(err);
        res.status(500).send("Internal Server Error"); // Send a generic error response
    });

});

expressApp.post("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.redirect("/");
        }

        res.clearCookie(process.env.SESSION_SECRET);
        res.redirect("/login");
    });
});

expressApp.post("/create-server", (req, res) => {
    axios.post("http://localhost:5000/api/guilds/create-guild", {
        user_id: req.session.user.id,
        guild_name: req.body.guild_name
    }, {
        headers: {
            'Authorization': `Bearer ${req.session.user.token}`
        }
    }).then((response) => {
        res.redirect("/channels/" + response.data.data);
    }).catch((err) => {
        console.log(err);
    });
});

app.on('ready', () => {
    console.log("ElectronApp is ready");
    let mainWindow = new BrowserWindow({
        minHeight: 520,
        minWidth: 1000,
    });
    mainWindow.loadURL("http://localhost:3000");

    mainWindow.webContents.openDevTools();
})

function checkAuthenticated(req, res, next) {
    if (req.session && req.session.isAuthenticated) {
        return next();
    }
    res.redirect('/login');
}

function checkNotAuthenticated(req, res, next) {
    if (req.session && req.session.isAuthenticated) {
        return res.redirect('/index');
    }
    next();
}

expressApp.use((req, res, next) => {
    res.status(404).render('../views/404.ejs');
});
