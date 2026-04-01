import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/rest-channel";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/rest-channel";
import { restChannelPlugin } from "./src/channel.js";
import { setRestChannelRuntime } from "./src/runtime.js";

const plugin = {
  id: "rest-channel",
  name: "REST Channel",
  description: "Bidirectional messaging over any HTTP/REST API",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setRestChannelRuntime(api.runtime);
    api.registerChannel({ plugin: restChannelPlugin });
  },
};

export default plugin;
