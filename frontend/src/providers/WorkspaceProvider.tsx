import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { api, setWorkspaceHeaders } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { Environment, Organization, Project } from "@/types";

interface WorkspaceContextValue {
  organizations: Organization[];
  projects: Project[];
  environments: Environment[];
  organization: Organization | null;
  project: Project | null;
  environment: Environment | null;
  setOrganizationId(id: string): void;
  setProjectId(id: string): void;
  setEnvironmentId(id: string): void;
  headers: Record<string, string>;
  loading: boolean;
  canWrite: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const stored = (key: string) => sessionStorage.getItem(`backplane.${key}`);
const remember = (key: string, value: string) => sessionStorage.setItem(`backplane.${key}`, value);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [organizationId, setOrganizationIdState] = useState(() => stored("organization"));
  const [projectId, setProjectIdState] = useState(() => stored("project"));
  const [environmentId, setEnvironmentIdState] = useState(() => stored("environment"));

  const organizationsQuery = useQuery({
    queryKey: ["organizations", user?.id],
    queryFn: () => api.get<Organization[]>("/organizations"),
    enabled: Boolean(user),
  });
  const organizations = useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data],
  );
  const organization =
    organizations.find((item) => item.id === organizationId) ?? organizations[0] ?? null;

  const organizationHeader = organization
    ? { "X-Organization-ID": organization.id }
    : undefined;
  const projectsQuery = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => api.get<Project[]>("/projects", organizationHeader),
    enabled: Boolean(organization),
  });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const project = projects.find((item) => item.id === projectId) ?? projects[0] ?? null;

  const projectHeaders =
    organization && project
      ? { "X-Organization-ID": organization.id, "X-Project-ID": project.id }
      : undefined;
  const environmentsQuery = useQuery({
    queryKey: ["environments", project?.id],
    queryFn: () => api.get<Environment[]>("/environments", projectHeaders),
    enabled: Boolean(project),
  });
  const environments = useMemo(
    () => environmentsQuery.data ?? [],
    [environmentsQuery.data],
  );
  const environment =
    environments.find((item) => item.id === environmentId) ?? environments[0] ?? null;

  const headers = useMemo(() => {
    const result: Record<string, string> = {};
    if (organization) result["X-Organization-ID"] = organization.id;
    if (project) result["X-Project-ID"] = project.id;
    if (environment) result["X-Environment-ID"] = environment.id;
    return result;
  }, [environment, organization, project]);

  useEffect(() => {
    setWorkspaceHeaders(headers);
    if (organization) remember("organization", organization.id);
    if (project) remember("project", project.id);
    if (environment) remember("environment", environment.id);
  }, [environment, headers, organization, project]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      organizations,
      projects,
      environments,
      organization,
      project,
      environment,
      setOrganizationId(id) {
        setOrganizationIdState(id);
        setProjectIdState(null);
        setEnvironmentIdState(null);
      },
      setProjectId(id) {
        setProjectIdState(id);
        setEnvironmentIdState(null);
      },
      setEnvironmentId(id) {
        setEnvironmentIdState(id);
      },
      headers,
      loading:
        organizationsQuery.isLoading || projectsQuery.isLoading || environmentsQuery.isLoading,
      canWrite: organization?.role !== "viewer",
    }),
    [
      environment,
      environments,
      environmentsQuery.isLoading,
      headers,
      organization,
      organizations,
      organizationsQuery.isLoading,
      project,
      projects,
      projectsQuery.isLoading,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return context;
}
