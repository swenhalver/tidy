import { LocalDesignStore } from "./store";

/** One store per server process, shared by every redirected web service module. */
export const local = new LocalDesignStore();
