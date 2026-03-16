 import { useState } from "react";
 import { useForm } from "react-hook-form";
 import { zodResolver } from "@hookform/resolvers/zod";
 import { z } from "zod";
 import { supabase } from "@/integrations/supabase/client";
 import { Button } from "@/components/ui/button";
 import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
 } from "@/components/ui/dialog";
 import {
   Form,
   FormControl,
   FormField,
   FormItem,
   FormLabel,
   FormMessage,
 } from "@/components/ui/form";
 import { Input } from "@/components/ui/input";
 import { useToast } from "@/hooks/use-toast";
 import { Loader2, Eye, EyeOff } from "lucide-react";
 
 const passwordSchema = z.object({
   newPassword: z.string()
     .min(8, "Password must be at least 8 characters")
     .max(72, "Password must be less than 72 characters"),
   confirmPassword: z.string(),
 }).refine((data) => data.newPassword === data.confirmPassword, {
   message: "Passwords do not match",
   path: ["confirmPassword"],
 });
 
 type PasswordFormValues = z.infer<typeof passwordSchema>;
 
 interface ChangePasswordDialogProps {
   open: boolean;
   onOpenChange: (open: boolean) => void;
 }
 
 const ChangePasswordDialog = ({ open, onOpenChange }: ChangePasswordDialogProps) => {
   const { toast } = useToast();
   const [isLoading, setIsLoading] = useState(false);
   const [showNewPassword, setShowNewPassword] = useState(false);
   const [showConfirmPassword, setShowConfirmPassword] = useState(false);
 
   const form = useForm<PasswordFormValues>({
     resolver: zodResolver(passwordSchema),
     defaultValues: {
       newPassword: "",
       confirmPassword: "",
     },
   });
 
   const onSubmit = async (values: PasswordFormValues) => {
     setIsLoading(true);
     try {
       const { error } = await supabase.auth.updateUser({
         password: values.newPassword,
       });
 
       if (error) {
         throw error;
       }
 
       toast({
         title: "Password updated",
         description: "Your password has been changed successfully.",
       });
       form.reset();
       onOpenChange(false);
     } catch (error: any) {
       toast({
         title: "Error",
         description: error.message || "Failed to update password",
         variant: "destructive",
       });
     } finally {
       setIsLoading(false);
     }
   };
 
   const handleOpenChange = (newOpen: boolean) => {
     if (!newOpen) {
       form.reset();
       setShowNewPassword(false);
       setShowConfirmPassword(false);
     }
     onOpenChange(newOpen);
   };
 
   return (
     <Dialog open={open} onOpenChange={handleOpenChange}>
       <DialogContent className="sm:max-w-[425px]">
         <DialogHeader>
           <DialogTitle>Change Password</DialogTitle>
           <DialogDescription>
             Enter your new password below. Make sure it's at least 8 characters.
           </DialogDescription>
         </DialogHeader>
         <Form {...form}>
           <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
             <FormField
               control={form.control}
               name="newPassword"
               render={({ field }) => (
                 <FormItem>
                   <FormLabel>New Password</FormLabel>
                   <FormControl>
                     <div className="relative">
                       <Input
                         type={showNewPassword ? "text" : "password"}
                         placeholder="Enter new password"
                         {...field}
                       />
                       <Button
                         type="button"
                         variant="ghost"
                         size="icon"
                         className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                         onClick={() => setShowNewPassword(!showNewPassword)}
                       >
                         {showNewPassword ? (
                           <EyeOff className="h-4 w-4 text-muted-foreground" />
                         ) : (
                           <Eye className="h-4 w-4 text-muted-foreground" />
                         )}
                       </Button>
                     </div>
                   </FormControl>
                   <FormMessage />
                 </FormItem>
               )}
             />
             <FormField
               control={form.control}
               name="confirmPassword"
               render={({ field }) => (
                 <FormItem>
                   <FormLabel>Confirm Password</FormLabel>
                   <FormControl>
                     <div className="relative">
                       <Input
                         type={showConfirmPassword ? "text" : "password"}
                         placeholder="Confirm new password"
                         {...field}
                       />
                       <Button
                         type="button"
                         variant="ghost"
                         size="icon"
                         className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                         onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                       >
                         {showConfirmPassword ? (
                           <EyeOff className="h-4 w-4 text-muted-foreground" />
                         ) : (
                           <Eye className="h-4 w-4 text-muted-foreground" />
                         )}
                       </Button>
                     </div>
                   </FormControl>
                   <FormMessage />
                 </FormItem>
               )}
             />
             <DialogFooter>
               <Button
                 type="button"
                 variant="outline"
                 onClick={() => handleOpenChange(false)}
                 disabled={isLoading}
               >
                 Cancel
               </Button>
               <Button type="submit" disabled={isLoading}>
                 {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                 Update Password
               </Button>
             </DialogFooter>
           </form>
         </Form>
       </DialogContent>
     </Dialog>
   );
 };
 
 export default ChangePasswordDialog;