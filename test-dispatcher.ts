import * as Lark from "@larksuiteoapi/node-sdk";

const dispatcher = new Lark.EventDispatcher({});
dispatcher.register({
    "im.message.receive_v1": async (data) => {
        console.log("Received via dispatcher:", data.message.content);
    }
});

const mockPayload = {
    header: { event_type: "im.message.receive_v1" },
    event: {
        message: { content: "{\"text\":\"你现在配置了哪些skills\"}" }
    }
};

(async () => {
    try {
        // The EventDispatcher in the SDK exposes invoke or doInvoke?
        // Let's just bypass and see what happens if we use the underlying methods if they exist.
        // Wait, the dispatcher has an `invoke` method
        await dispatcher.invoke(mockPayload);
        console.log("EventDispatcher test passed");
    } catch (err) {
        console.error("EventDispatcher error:", err);
    }
})();
