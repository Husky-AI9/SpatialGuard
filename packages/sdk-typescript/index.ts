import type { components } from "../contracts/generated";
// The API materializes all top-level defaults when returning a revision.
export type Layout = Required<components["schemas"]["Layout"]>;
export type Observation = components["schemas"]["Observation"];
export type CalibrationInput = components["schemas"]["CalibrationInput"];
export type Room = Layout["rooms"][number];
export type Camera = Layout["cameras"][number];
export type Portal = Layout["portals"][number];
export type Zone = Layout["zones"][number];
export type Revision = {
  revision_id: string;
  site_id: string;
  tenant_id: string;
  parent_revision_id: string | null;
  state: "draft" | "published";
  version: number;
  content_hash: string | null;
  created_at: string;
  layout: Layout;
};
export class TwinForgeClient {
  constructor(
    public token: string,
    public baseUrl = "",
  ) {}
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    version?: number,
  ): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : { "X-TwinForge-Local": "1" }),
        "Content-Type": "application/json",
        ...(version !== undefined ? { "If-Match": `"${version}"` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const e = await response.json();
      throw new Error(
        [
          e.message,
          ...(e.details || []).map((d: unknown) =>
            typeof d === "string" ? d : JSON.stringify(d),
          ),
        ].join("\n"),
      );
    }
    return response.status === 204 ? (undefined as T) : response.json();
  }
  revision(id: string) {
    return this.request<Revision>(`/v1/revisions/${id}`);
  }
  query(id: string, body: unknown) {
    return this.request<Record<string, unknown>>(
      `/v1/revisions/${id}/query`,
      "POST",
      body,
    );
  }
}
