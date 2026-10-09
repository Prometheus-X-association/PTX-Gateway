import { lazy } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { studioApi } from "@/services/studioApi";
const LegacyGateway = lazy(() => import("./OrgGateway"));
export default function OrgEntryPage() {
  const { slug } = useParams();
  const { search } = useLocation();
  const { user, isLoading } = useAuth();
  const eligible = Boolean(user && !search);
  const landing = useQuery({
    queryKey: ["studio-landing", user?.id, slug],
    enabled: eligible,
    staleTime: 0,
    retry: false,
    queryFn: () =>
      studioApi<{ applicationSlug: string | null }>("landing", undefined, {
        orgSlug: slug,
      }),
  });
  if (!search && (isLoading || eligible && landing.isPending)) {
    return <p role="status" className="p-8">Loading gateway…</p>;
  }
  if (eligible && landing.data?.applicationSlug) {
    return (
      <Navigate
        replace
        to={`/o/${encodeURIComponent(slug!)}/apps/${
          encodeURIComponent(landing.data.applicationSlug)
        }`}
      />
    );
  }
  return <LegacyGateway />;
}
