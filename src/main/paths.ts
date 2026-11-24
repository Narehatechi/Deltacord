import { app } from "electron";
import { join } from "node:path";

// Imported first by everything in the main process, so Deltacord's data never mixes with any other app's.
app.setName("Deltacord");
app.setPath("userData", join(app.getPath("appData"), "Deltacord Desktop"));

export const ASSETS = join(__dirname, "assets");
