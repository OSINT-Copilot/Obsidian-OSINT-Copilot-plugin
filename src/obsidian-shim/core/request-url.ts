/**
 * requestUrl -- Obsidian's CORS-free HTTP, now main-process HTTP over IPC.
 *
 * The response shape matters more than it looks: every consumer reads .text/.json/
 * .arrayBuffer as PROPERTIES, never as methods (updater-service.ts:38, :68,
 * geocoding-service.ts:465, miro-import-service.ts:280, api-service.ts:211). So the
 * body must be materialised eagerly and `json` must be a getter that throws on bad
 * JSON, matching Obsidian.
 *
 * Header keys are lowercased because api-service.ts:210 reads headers['content-type'].
 */
import { host } from '../../host';

export interface RequestUrlParam {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    contentType?: string;
    /** false => non-2xx resolves normally. wayback and enrichers depend on this. */
    throw?: boolean;
}

export interface RequestUrlResponse {
    status: number;
    headers: Record<string, string>;
    arrayBuffer: ArrayBuffer;
    text: string;
    /** Typed `any` to match Obsidian: callers assign it straight to their own shapes. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly json: any;
}

export async function requestUrl(param: RequestUrlParam | string): Promise<RequestUrlResponse> {
    const request = typeof param === 'string' ? { url: param } : param;
    const response = await host.net.request(request);

    return {
        status: response.status,
        headers: response.headers,
        arrayBuffer: response.arrayBuffer,
        text: response.text,
        get json() {
            return JSON.parse(response.text);
        },
    };
}
