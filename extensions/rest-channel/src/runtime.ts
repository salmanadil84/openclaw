import type { PluginRuntime } from "openclaw/plugin-sdk/rest-channel";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const {
  setRuntime: setRestChannelRuntime,
  clearRuntime: clearRestChannelRuntime,
  getRuntime: getRestChannelRuntime,
} = createPluginRuntimeStore<PluginRuntime>("REST channel runtime not initialized");

export { clearRestChannelRuntime, getRestChannelRuntime, setRestChannelRuntime };
