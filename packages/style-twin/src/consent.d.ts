import type { ConsentGrant, ConsentScope } from "./types";
export declare function grantConsent(scope: ConsentScope): ConsentGrant;
export declare function assertConsent(grant: ConsentGrant | null | undefined, expected: ConsentScope): asserts grant is ConsentGrant;
