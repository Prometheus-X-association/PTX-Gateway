import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Sparkles } from "lucide-react";

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, signUp, isAuthenticated, isLoading } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get the intended destination from location state, default to /debug
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || "/debug";

  // Redirect already authenticated users to their intended destination
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, from]);

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Signup form state
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [signupFullName, setSignupFullName] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const { error } = await signIn(loginEmail, loginPassword);

    if (error) {
      toast.error(error.message || "Failed to sign in");
      setIsSubmitting(false);
    } else {
      toast.success("Welcome back!");
      navigate(from, { replace: true });
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (signupPassword !== signupConfirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (signupPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setIsSubmitting(true);

    const { error } = await signUp(signupEmail, signupPassword, signupFullName);

    if (error) {
      toast.error(error.message || "Failed to sign up");
    } else {
      toast.success("Check your email to verify your account");
    }

    setIsSubmitting(false);
  };

  // Show loading while checking auth state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30 pointer-events-none">
        <div className="absolute inset-0" style={{ background: "var(--gradient-glow)" }} />
      </div>

      <Card className="w-full max-w-md relative z-10 glass-card">
        <CardHeader className="text-center">
          <div className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-4 mx-auto">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-primary font-medium">PDC Gateway</span>
          </div>
          <CardTitle className="text-2xl">Welcome</CardTitle>
          <CardDescription>Sign in to access the Data Analytics Platform</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    disabled={isSubmitting}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Full Name</Label>
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="John Doe"
                    value={signupFullName}
                    onChange={(e) => setSignupFullName(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="you@example.com"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    required
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    required
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-confirm-password">Confirm Password</Label>
                  <Input
                    id="signup-confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={signupConfirmPassword}
                    onChange={(e) => setSignupConfirmPassword(e.target.value)}
                    required
                    disabled={isSubmitting}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    "Create Account"
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            By continuing, you agree to our Terms of Service
          </p>
        </CardFooter>
      </Card>
    </div>
  );
};

export default LoginPage;
