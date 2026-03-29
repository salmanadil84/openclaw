import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { restChannelPlugin } from "./src/channel.js";
import { setRestChannelRuntime } from "./src/runtime.js";

export { restChannelPlugin } from "./src/channel.js";
export { setRestChannelRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "rest-channel",
  name: "REST Channel",
  description: "Bidirectional messaging over any HTTP/REST API",
  plugin: restChannelPlugin,
  setRuntime: setRestChannelRuntime,
});
