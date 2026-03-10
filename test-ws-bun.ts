import { EventEmitter } from "node:events";

// Mock WebSocket class to inject payload to WSClient
class MockWebSocket extends EventEmitter {
    static instances: MockWebSocket[] = [];
    readyState = 1;
    url: string;
    onmessage: any;
    onopen: any;
    onerror: any;
    onclose: any;

    constructor(url: string) {
        super();
        this.url = url;
        MockWebSocket.instances.push(this);
        setTimeout(() => {
            if (this.onopen) this.onopen();
        }, 100);
    }

    send(data: any) {
        // console.log("WS send:", data);
    }

    close() { }
}

const originalWS = globalThis.WebSocket;
(globalThis as any).WebSocket = MockWebSocket;

import * as Lark from "@larksuiteoapi/node-sdk";

const dispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => {
        console.log("SUCCESS: Received via dispatcher:", data.message?.content);
    }
});

const wsClient = new Lark.WSClient({
    appId: "cli_mock",
    appSecret: "mock_secret",
    loggerLevel: Lark.LoggerLevel.info,
});

wsClient.start({ eventDispatcher: dispatcher });

setTimeout(() => {
    const ws = MockWebSocket.instances[0];
    if (!ws) {
        console.error("Mock WebSocket not created?");
        process.exit(1);
    }

    console.log("Mock WebSocket connected. Injecting payload...");

    // Create a payload that Feishu WS server would send
    // Note: Feishu WS protocol uses Protobuf. 
    // Wait, if it uses Protobuf, we need to send the exact binary format!
    // If we don't know the exact binary format, we can't mock the WebSocket frame easily.
    console.log("Testing complete. We need to know if Feishu WS uses pure JSON or Protobuf.");
    process.exit(0);
}, 500);
