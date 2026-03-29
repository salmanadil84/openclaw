import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { restChannelPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(restChannelPlugin);
