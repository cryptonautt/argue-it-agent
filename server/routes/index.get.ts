// Nitro's [...page] catch-all doesn't match "/". ARGUE IT serves its feed at "/" (homePath "/"), so "/" needs
// its own route to the same SSR handler (same fix as the framework's builder-code-starter template).
export { default } from "./[...page].get.js";
