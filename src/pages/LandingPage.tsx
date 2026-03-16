import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  ArrowRight,
  Shield,
  Zap,
  Database,
  Users,
  Globe,
  Lock,
  BarChart3,
  CheckCircle2,
  Search,
  AlertCircle,
  Workflow,
  AppWindow,
  Blocks,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import UserMenu from "@/components/UserMenu";

// Intersection Observer hook for scroll animations
const useInView = (threshold = 0.1) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
        }
      },
      { threshold },
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [threshold]);

  return { ref, isInView };
};

// Animated Section Component
const AnimatedSection = ({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) => {
  const { ref, isInView } = useInView(0.15);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${className}`}
      style={{
        opacity: isInView ? 1 : 0,
        transform: isInView ? "translateY(0)" : "translateY(40px)",
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
};

const LandingPage = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [orgSlug, setOrgSlug] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [orgMatches, setOrgMatches] = useState<Array<{ id: string; name: string; slug: string; description: string | null }>>([]);

  const handleOrgSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgSlug.trim()) return;

    setIsSearching(true);
    setError(null);
    setInfo(null);
    setOrgMatches([]);

    try {
      const searchTerm = orgSlug.trim();

      // Check if organization exists
      const { data, error: dbError } = await supabase
        .from("organizations")
        .select("slug")
        .eq("slug", searchTerm.toLowerCase())
        .eq("is_active", true)
        .maybeSingle();

      if (dbError) throw dbError;

      if (data) {
        navigate(`/${data.slug}`);
      } else {
        const escaped = searchTerm.replace(/[%_]/g, "").trim();

        if (!escaped) {
          setError("Organization/department not found. Please check the identifier and try again.");
          return;
        }

        const { data: matches, error: matchesError } = await supabase
          .from("organizations")
          .select("id, name, slug, description")
          .eq("is_active", true)
          .eq("settings->>public_discovery_enabled", "true")
          .or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%`)
          .order("name", { ascending: true })
          .limit(8);

        if (matchesError) throw matchesError;

        if (matches && matches.length > 0) {
          setOrgMatches(matches);
          setInfo("No exact slug match found. Showing public organizations matching your keyword.");
        } else {
          setError("Organization/department not found. Please check the identifier and try again.");
        }
      }
    } catch (err) {
      console.error("Error searching organization/department:", err);
      setError("An error occurred. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  const features = [
    {
      icon: Users,
      title: "Organization & Role Administration",
      description: "Manage organizations, invitations, memberships, and role-based access with isolated admin controls per tenant.",
    },
    {
      icon: Zap,
      title: "Contract Extraction Automation",
      description: "Convert PTX contract structures into offerings, resources, and service-chain configuration with less manual setup.",
    },
    {
      icon: Database,
      title: "Resource and Service-Chain Lifecycle Management",
      description: "Configure resource URLs, parameters, placeholders, embedded resources, and reusable service-chain execution flows.",
    },
    {
      icon: BarChart3,
      title: "Automatic PDC Payload Generation",
      description: "Generate validated PDC payloads from selected resources, chains, and user-provided data without manual JSON authoring.",
    },
    {
      icon: AlertCircle,
      title: "Debug Mode with Human-in-the-Loop Validation",
      description: "Review payload structure and execution readiness in debug mode before processing to reduce runtime errors.",
    },
    {
      icon: Shield,
      title: "Secure Processing and Token Controls",
      description: "Use org-scoped secrets, tokenized execution, and server-side authorization checks for protected PTX/PDC operations.",
    },
    {
      icon: Globe,
      title: "Secure Embedding (Iframe & Web Component)",
      description: "Embed the gateway in external platforms with allowed-origin enforcement and temporary or persistent embed tokens.",
    },
    {
      icon: Lock,
      title: "Settings Backup and Restore",
      description: "Export and import organization settings for repeatable setup, migration, and recovery across environments.",
    },
    {
      icon: Sparkles,
      title: "Open Source and Extensible Architecture",
      description: "Adopt an open-source foundation that supports customization, integration, and transparent governance.",
    },
  ];

  const benefits = [
    "Shorten the path from PTX contract setup to operational visualization and execution",
    "Improve operational quality with automatic payload generation and validation checkpoints",
    "Reuse one governed configuration across direct access, iframe, web component, and standalone channels",
    "Keep stronger control of organizational policies, permissions, and execution boundaries",
    "Lower platform lock-in risk with open-source, extensible implementation",
    "Accelerate collaboration in PTX dataspace ecosystems with more consistent partner integration",
  ];

  const implementationStages = [
    {
      icon: Workflow,
      title: "Contract to Config",
      description:
        "Translate PTX contract structures into offerings, resources, parameters, and service-chain logic without rebuilding the flow by hand.",
    },
    {
      icon: BarChart3,
      title: "Config to Visualization",
      description:
        "Turn the configured contract into an executable user journey that collects inputs, runs the workflow, and returns the visualization outcome.",
    },
    {
      icon: Blocks,
      title: "Integrated or Standalone",
      description:
        "Deploy the same governed experience inside another platform or as a standalone PTX application, depending on organizational needs.",
    },
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {isAuthenticated && (
        <div className="fixed top-4 right-4 z-30">
          <UserMenu />
        </div>
      )}

      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] opacity-20">
          <div className="absolute inset-0 rounded-full" style={{ background: "var(--gradient-glow)" }} />
        </div>
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] opacity-15">
          <div className="absolute inset-0 rounded-full" style={{ background: "var(--gradient-glow)" }} />
        </div>
      </div>

      {/* Hero Section */}
      <section className="relative z-10 min-h-screen flex items-center justify-center px-4 py-20">
        <div className="max-w-5xl mx-auto text-center">
          <AnimatedSection>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-8">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm text-primary font-medium">PTX Gateway</span>
            </div>
          </AnimatedSection>

          <AnimatedSection delay={100}>
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
              From PTX Contract to <span className="gradient-text">Operational Visualization</span>
            </h1>
          </AnimatedSection>

          <AnimatedSection delay={200}>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-3xl mx-auto mb-12">
              PTX Gateway helps organizations move fast from contract definition to executable visualization, whether
              embedded in another platform or delivered as a standalone app to operationalize the PTX contract.
            </p>
          </AnimatedSection>

          <AnimatedSection delay={250}>
            <div className="grid gap-4 sm:grid-cols-3 max-w-4xl mx-auto mb-12 text-left">
              <div className="glass-card p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-primary mb-2">Speed</p>
                <p className="text-sm text-muted-foreground">
                  Reduce manual implementation work between PTX contract structure and usable application flow.
                </p>
              </div>
              <div className="glass-card p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-primary mb-2">Flexibility</p>
                <p className="text-sm text-muted-foreground">
                  Support integrated deployment in existing platforms or independent operation as a dedicated gateway.
                </p>
              </div>
              <div className="glass-card p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-primary mb-2">Operationalization</p>
                <p className="text-sm text-muted-foreground">
                  Make PTX contracts actionable through governed execution, result delivery, and visualization.
                </p>
              </div>
            </div>
          </AnimatedSection>

          <AnimatedSection delay={300}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="#find-org"
                className="px-8 py-4 rounded-lg font-medium bg-primary text-primary-foreground hover:opacity-90 transition-all glow-effect flex items-center gap-2"
              >
                Find Your Gateway
                <ArrowRight className="w-5 h-5" />
              </a>
              <a
                href="#what-is-dataspace"
                className="px-8 py-4 rounded-lg font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                Learn More
              </a>
            </div>
          </AnimatedSection>

          {/* Scroll indicator */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
            <div className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 flex items-start justify-center p-2">
              <div className="w-1.5 h-3 bg-muted-foreground/50 rounded-full" />
            </div>
          </div>
        </div>
      </section>

      {/* What is Dataspace Section */}
      <section id="what-is-dataspace" className="relative z-10 py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                What is a <span className="gradient-text">Dataspace</span>?
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                A dataspace is a decentralized infrastructure that enables secure, sovereign data sharing between
                organizations while respecting privacy and compliance requirements.
              </p>
            </div>
          </AnimatedSection>

          <div className="grid md:grid-cols-3 gap-8">
            <AnimatedSection delay={100}>
              <div className="glass-card p-6 h-full">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Shield className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Data Sovereignty</h3>
                <p className="text-muted-foreground">
                  Organizations retain full ownership and control over their data. Access is granted through explicit
                  consent and smart contracts.
                </p>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={200}>
              <div className="glass-card p-6 h-full">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Globe className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Interoperability</h3>
                <p className="text-muted-foreground">
                  Built on open standards like Gaia-X and IDSA, enabling seamless data exchange across different
                  platforms and ecosystems.
                </p>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={300}>
              <div className="glass-card p-6 h-full">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <BarChart3 className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Value Creation</h3>
                <p className="text-muted-foreground">
                  Unlock new insights and business models by combining data from multiple sources while maintaining
                  trust and transparency.
                </p>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* PTX Gateway Objectives Section */}
      <section className="relative z-10 py-24 px-4 bg-muted/30">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                PTX Gateway <span className="gradient-text">Objectives</span>
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                PTX Gateway is designed to accelerate implementation from PTX contract to visualization and give
                organizations flexible deployment choices for operational use.
              </p>
            </div>
          </AnimatedSection>

          <div className="grid md:grid-cols-2 gap-8">
            <AnimatedSection delay={100}>
              <div className="glass-card p-8">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-primary font-bold">1</span>
                  </div>
                  Implement Faster from Contract Structure
                </h3>
                <p className="text-muted-foreground pl-13">
                  Transform PTX contract definitions into usable offerings, resources, parameters, and service-chain
                  structures so teams can configure delivery faster and with less repeated setup work.
                </p>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={200}>
              <div className="glass-card p-8">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-primary font-bold">2</span>
                  </div>
                  Move from Contract to Visualization
                </h3>
                <p className="text-muted-foreground pl-13">
                  Build valid PDC execution payloads and guided user flows that turn contract logic into an
                  operational experience with visualization-ready outputs.
                </p>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={300}>
              <div className="glass-card p-8">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-primary font-bold">3</span>
                  </div>
                  Fit Existing Platforms or Run Alone
                </h3>
                <p className="text-muted-foreground pl-13">
                  Deploy the gateway as an integrated capability inside another platform or as a standalone application
                  while keeping the same governed PTX execution model.
                </p>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={400}>
              <div className="glass-card p-8">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-primary font-bold">4</span>
                  </div>
                  Operationalize PTX Contracts Reliably
                </h3>
                <p className="text-muted-foreground pl-13">
                  Let admins control advanced PTX/PDC configuration while users follow a guided process to execute
                  contracts, retrieve results, and reuse the setup consistently across channels.
                </p>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Implementation Path Section */}
      <section className="relative z-10 py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                Implementation <span className="gradient-text">Path</span>
              </h2>
              <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
                A focused delivery path for organizations that want to operationalize PTX contracts quickly without
                separating contract logic, execution flow, and visualization into disconnected tools.
              </p>
            </div>
          </AnimatedSection>

          <div className="grid gap-6 md:grid-cols-3">
            {implementationStages.map((stage, index) => (
              <AnimatedSection key={stage.title} delay={index * 100}>
                <div className="glass-card p-6 h-full relative overflow-hidden">
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/80 to-transparent" />
                  <stage.icon className="w-8 h-8 text-primary mb-4" />
                  <h3 className="text-xl font-semibold mb-3">{stage.title}</h3>
                  <p className="text-sm text-muted-foreground">{stage.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>

          <AnimatedSection delay={350}>
            <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr] mt-10">
              <div className="glass-card p-8">
                <h3 className="text-2xl font-semibold mb-4">One PTX implementation, multiple delivery models</h3>
                <p className="text-muted-foreground mb-6">
                  PTX Gateway keeps the contract-driven configuration governed in one place, then exposes it through
                  the delivery model that fits the organization.
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border/60 bg-background/30 p-5">
                    <AppWindow className="w-6 h-6 text-primary mb-3" />
                    <h4 className="font-semibold mb-2">Integrated with Other Platforms</h4>
                    <p className="text-sm text-muted-foreground">
                      Embed the gateway in partner portals, learning platforms, or operational systems while keeping
                      PTX execution governed and reusable.
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/30 p-5">
                    <Blocks className="w-6 h-6 text-primary mb-3" />
                    <h4 className="font-semibold mb-2">Standalone PTX Application</h4>
                    <p className="text-sm text-muted-foreground">
                      Run it as a dedicated application for direct user access when the organization needs an
                      independent contract execution and visualization surface.
                    </p>
                  </div>
                </div>
              </div>

              <div className="glass-card p-8 bg-gradient-to-br from-primary/5 to-primary/10">
                <p className="text-xs uppercase tracking-[0.2em] text-primary mb-3">Objective</p>
                <h3 className="text-2xl font-semibold mb-4">
                  Operationalize the PTX contract instead of leaving it as configuration only
                </h3>
                <p className="text-muted-foreground">
                  The gateway closes the gap between contractual structure and day-to-day usage by turning PTX
                  definitions into an executable, visual, organization-ready application layer.
                </p>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="relative z-10 py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <AnimatedSection>
              <div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-6">
                  Benefits for <span className="gradient-text">Organizations</span>
                </h2>
                <p className="text-lg text-muted-foreground mb-8">
                  Outcome-focused advantages for organizations adopting PTX dataspace contracts and gateway-based
                  execution.
                </p>
                <ul className="space-y-4">
                  {benefits.map((benefit, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <span className="text-muted-foreground">{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={200}>
              <div className="glass-card p-8 bg-gradient-to-br from-primary/5 to-primary/10">
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/20 mb-6">
                    <Sparkles className="w-10 h-10 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold mb-4">Ready to Get Started?</h3>
                  <p className="text-muted-foreground mb-6">
                    Enter your organization's identifier below to access your dedicated gateway.
                  </p>
                  <a
                    href="#find-org"
                    className="inline-flex items-center gap-2 text-primary hover:underline font-medium"
                  >
                    Find Your Gateway
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative z-10 py-24 px-4 bg-muted/30">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                Platform <span className="gradient-text">Features</span>
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Core capabilities for contract-driven PTX execution, secure embedding, and governed administration.
              </p>
              <div className="mt-6">
                <Button variant="outline" asChild>
                  <a href="/docs/admin-pages-guide.html" target="_blank" rel="noopener noreferrer">
                    Open Admin Documentation
                  </a>
                </Button>
              </div>
            </div>
          </AnimatedSection>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <AnimatedSection key={feature.title} delay={index * 100}>
                <div className="glass-card p-6 h-full hover:border-primary/30 transition-colors">
                  <feature.icon className="w-8 h-8 text-primary mb-4" />
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Find Organization Section */}
      <section id="find-org" className="relative z-10 py-24 px-4">
        <div className="max-w-xl mx-auto">
          <AnimatedSection>
            <div className="glass-card p-8 sm:p-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-6">
                <Search className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold mb-4">Access Your Gateway</h2>
              <p className="text-muted-foreground mb-8">
                Enter your organization's unique identifier or slug to access your dedicated PTX Gateway and start
                exploring data resources.
              </p>

              <form onSubmit={handleOrgSearch} className="space-y-4">
                <div className="relative">
                  <Input
                    value={orgSlug}
                    onChange={(e) => {
                      setOrgSlug(e.target.value);
                      setError(null);
                      setInfo(null);
                      setOrgMatches([]);
                    }}
                    placeholder="Enter organization slug (e.g., acme-corp)"
                    className="h-12 pl-4 pr-12 text-base bg-background/50 border-border/50 focus:border-primary"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={isSearching || !orgSlug.trim()}
                    className="absolute right-1 top-1 h-10 w-10"
                  >
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </div>
                )}
                {info && (
                  <div className="text-sm text-primary">{info}</div>
                )}

                {orgMatches.length > 0 && (
                  <div className="mt-3 space-y-2 text-left">
                    {orgMatches.map((org) => (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => navigate(`/${org.slug}`)}
                        className="w-full rounded-lg border border-border bg-background/40 p-3 text-left hover:border-primary/40 hover:bg-background/70 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-foreground">{org.name}</p>
                          <span className="text-xs text-primary font-mono">{org.slug}</span>
                        </div>
                        {org.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{org.description}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </form>

              <p className="text-xs text-muted-foreground mt-6">
                Don't have an organization? Contact your administrator or{" "}
                <a href="/login" className="text-primary hover:underline">
                  sign in
                </a>{" "}
                to create one.
              </p>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-8 px-4 border-t border-border/50">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-sm text-muted-foreground">
            Built on Prometheus-X dataspace technology • Secure • Interoperable • Compliant
          </p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
