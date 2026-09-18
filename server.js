let express = require('express');
let { WebSocketServer } = require('ws');
let http = require('http');
let path = require('path');
let fs = require('fs');

let app = express();
let server = http.createServer(app);
let wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, './')));

let clients = new Map();
let registeredRoutes = new Map();
let ROUTE_FILE = path.join(__dirname, 'routes.json');

function loadRoutesFromFile() {
    try {
        if (fs.existsSync(ROUTE_FILE)) {
            let data = fs.readFileSync(ROUTE_FILE, 'utf8');
            let parsed = JSON.parse(data);
            registeredRoutes.clear();
            parsed.forEach(([p, a]) => registeredRoutes.set(p, a));
            console.log('Loaded routes from routes.json');
        }
    } catch (err) {
        console.error('Failed to load routes from file:', err);
    }
}

loadRoutesFromFile();

wss.on('connection', (ws) => {
    console.log('Client connected via WebSocket');
    clients.set(ws, new Set());

    ws.send(JSON.stringify({
        type: 'init_config',
        routes: Array.from(registeredRoutes.entries())
    }));

    ws.on('message', (message) => {
        try {
            let data = JSON.parse(message);
            if (data.type === 'sync_client_routes') {
                let clientRoutes = data.routes;
                let clientStoredPaths = clients.get(ws);
                clientStoredPaths.clear();

                clientRoutes.forEach(r => {
                    let cleanPath = r.path.startsWith('/') ? r.path : '/' + r.path;
                    clientStoredPaths.add(cleanPath);
                    registeredRoutes.set(cleanPath, r.audio);
                    registerExpressRoute(cleanPath);
                });

                recalculateGlobalRoutes();
            }
        } catch (e) {
            console.error('Error processing client message:', e);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        clients.delete(ws);
        recalculateGlobalRoutes();
    });
});

function registerExpressRoute(cleanPath) {
    app.get(cleanPath, (req, resHttp) => {
        let baseAudioId = registeredRoutes.get(cleanPath) || 'successAudio';
        let n = req.query.n;
        let audioId = baseAudioId;

        if (n !== undefined) {
            let prefix = baseAudioId.startsWith('error') ? 'errorAudio' : 'successAudio';
            audioId = n == 1 ? prefix : `${prefix}${n}`;
        }

        broadcast({
            type: 'trigger',
            path: cleanPath,
            audio: audioId,
            n: n
        });
        
        let queryDetails = n !== undefined ? `?n=${n}` : '';
        resHttp.send(`Endpoint <code>${cleanPath}${queryDetails}</code> triggered! Audio: ${audioId}`);
    });
}

function recalculateGlobalRoutes() {
    let activePaths = new Set();
    clients.forEach((pathSet) => {
        pathSet.forEach(p => activePaths.add(p));
    });

    for (let [path] of registeredRoutes) {
        if (!activePaths.has(path)) {
            registeredRoutes.delete(path);
        }
    }

    broadcastConfigUpdate();
}

function broadcastConfigUpdate() {
    let payload = JSON.stringify({
        type: 'config_updated',
        routes: Array.from(registeredRoutes.entries())
    });
    clients.forEach((_, client) => {
        if (client.readyState === client.OPEN) {
            client.send(payload);
        }
    });
}

function broadcast(data) {
    let payload = JSON.stringify(data);
    clients.forEach((_, client) => {
        if (client.readyState === client.OPEN) {
            client.send(payload);
        }
    });
}

app.post('/api/save-routes', (req, res) => {
    try {
        let routesArray = Array.from(registeredRoutes.entries());
        fs.writeFileSync(ROUTE_FILE, JSON.stringify(routesArray, null, 2));
        res.json({ status: 'success', message: 'Routes saved to routes.json successfully!' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/load-routes', (req, res) => {
    try {
        loadRoutesFromFile();
        broadcastConfigUpdate();
        res.json({ status: 'success', routes: Array.from(registeredRoutes.entries()) });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

let PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});