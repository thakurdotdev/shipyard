const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export const api = {
  getProjects: async () => {
    const res = await fetch(`${API_URL}/projects`);
    if (!res.ok) throw new Error("Failed to fetch projects");
    return res.json();
  },
  createProject: async (data: any) => {
    const res = await fetch(`${API_URL}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to create project");
    return res.json();
  },
  getProject: async (id: string) => {
    const res = await fetch(`${API_URL}/projects/${id}`);
    if (!res.ok) throw new Error("Failed to fetch project");
    return res.json();
  },
  getBuilds: async (projectId: string) => {
    const res = await fetch(`${API_URL}/projects/${projectId}/builds`);
    if (!res.ok) throw new Error("Failed to fetch builds");
    return res.json();
  },
  triggerBuild: async (projectId: string) => {
    const res = await fetch(`${API_URL}/projects/${projectId}/builds`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to trigger build");
    return res.json();
  },
  getBuild: async (buildId: string) => {
    const res = await fetch(`${API_URL}/builds/${buildId}`);
    if (!res.ok) throw new Error("Failed to fetch build");
    return res.json();
  },
  getBuildLogs: async (buildId: string) => {
    const res = await fetch(`${API_URL}/builds/${buildId}/logs`);
    if (!res.ok) throw new Error("Failed to fetch build logs");
    return res.text();
  },
  getEnvVars: async (projectId: string) => {
    const res = await fetch(`${API_URL}/projects/${projectId}/env`);
    if (!res.ok) throw new Error("Failed to fetch env vars");
    return res.json();
  },
  addEnvVar: async (projectId: string, data: any) => {
    const res = await fetch(`${API_URL}/projects/${projectId}/env`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to add env var");
    return res.json();
  },
  deleteEnvVar: async (projectId: string, key: string) => {
    const res = await fetch(`${API_URL}/projects/${projectId}/env/${key}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete env var");
    return res.json();
  },
  async activateBuild(buildId: string) {
    const res = await fetch(`${API_URL}/deploy/build/${buildId}/activate`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to activate build");
    return res.json();
  },

  async getActiveDeployment(projectId: string) {
    const res = await fetch(`${API_URL}/projects/${projectId}/deployment`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error("Failed to get active deployment");
    }
    return res.json();
  },

  async deleteProject(projectId: string) {
    const res = await fetch(`${API_URL}/projects/${projectId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete project");
    return res.json();
  },
  async stopDeployment(projectId: string) {
    const res = await fetch(`${API_URL}/projects/${projectId}/stop`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to stop deployment");
    return res.json();
  },
};
