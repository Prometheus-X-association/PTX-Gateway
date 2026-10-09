import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import ApplicationPrototype from "@/components/applications/ApplicationPrototype";

export default function ApplicationPreviewPage() {
  const { organizationId } = useParams();
  const { user } = useAuth();
  if (!organizationId || organizationId !== user?.organization?.id) return <main className="container py-12"><h1 className="text-2xl font-bold">Organization mismatch</h1><p className="my-4">Switch to the matching organization before opening its application preview.</p><Link className="underline" to="/admin?section=applications">Return to organization admin</Link></main>;
  return <main className="container max-w-7xl px-4 py-8"><ApplicationPrototype key={`${user.id}:${organizationId}`} standalone /></main>;
}
