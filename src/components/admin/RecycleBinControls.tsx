import { useMemo, useState } from "react";
import { ArchiveRestore, Recycle, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { recycleExpiry, type RecyclableItem } from "@/components/admin/recycleBin";

export const ConfirmRecycleButton = ({ name, itemLabel, onConfirm, iconOnly = true }: { name: string; itemLabel: string; onConfirm: () => void; iconOnly?: boolean }) => <AlertDialog>
  <AlertDialogTrigger asChild>
    <Button type="button" variant="ghost" size={iconOnly ? "icon" : "sm"} className={iconOnly ? "h-7 w-7 text-destructive hover:text-destructive" : "h-7 gap-1.5 text-xs text-destructive hover:text-destructive"} title={`Move ${itemLabel} to recycle bin`}>
      <Trash2 className="h-3.5 w-3.5" />{!iconOnly && "Move to recycle bin"}
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader><AlertDialogTitle>Move “{name}” to the recycle bin?</AlertDialogTitle><AlertDialogDescription>The {itemLabel} will be disabled immediately. You can restore it for 30 days before it is permanently deleted automatically.</AlertDialogDescription></AlertDialogHeader>
    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={onConfirm}>Move to recycle bin</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>;

export const RecycleBinPanel = ({ title, itemLabel, items, open, onToggle, onRestore, onDelete }: { title: string; itemLabel: string; items: RecyclableItem[]; open: boolean; onToggle: () => void; onRestore: (id: string) => void; onDelete: (id: string) => void }) => {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"deleted_desc" | "deleted_asc" | "name_asc" | "name_desc">("deleted_desc");
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = normalizedQuery ? items.filter((item) => item.name.toLocaleLowerCase().includes(normalizedQuery)) : items;
    return [...filtered].sort((left, right) => {
      if (sortBy === "name_asc" || sortBy === "name_desc") {
        const result = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
        return sortBy === "name_asc" ? result : -result;
      }
      const leftDate = left.deletedAt ? Date.parse(left.deletedAt) : 0;
      const rightDate = right.deletedAt ? Date.parse(right.deletedAt) : 0;
      return sortBy === "deleted_asc" ? leftDate - rightDate : rightDate - leftDate;
    });
  }, [items, query, sortBy]);

  return <>
    <Button type="button" variant={open ? "secondary" : "outline"} size="sm" className="h-7 gap-1.5 text-xs" onClick={onToggle}><Recycle className="h-3.5 w-3.5" /> {title} {items.length > 0 && <Badge variant="secondary" className="px-1.5 text-[9px]">{items.length}</Badge>}</Button>
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) setQuery(""); if (nextOpen !== open) onToggle(); }}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><Recycle className="h-4 w-4" />{title}</DialogTitle>
          <DialogDescription>Restore items or delete them permanently. Items are automatically removed 30 days after deletion.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          {(items.length > 5 || query) && <div className="relative min-w-[220px] flex-1"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 pl-8 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Find ${itemLabel}…`} /></div>}
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
            <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="deleted_desc">Deleted: newest first</SelectItem><SelectItem value="deleted_asc">Deleted: oldest first</SelectItem><SelectItem value="name_asc">Name: A–Z</SelectItem><SelectItem value="name_desc">Name: Z–A</SelectItem></SelectContent>
          </Select>
          <Badge variant="outline" className="text-[10px]">{visibleItems.length} of {items.length}</Badge>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {items.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">The recycle bin is empty.</p> : visibleItems.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No matching items found.</p> : <div className="divide-y rounded-lg border">{visibleItems.map((item) => {
            const daysRemaining = Math.max(0, Math.ceil((recycleExpiry(item) - Date.now()) / (24 * 60 * 60 * 1000)));
            return <div key={item.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.name}</p><p className="text-[10px] text-muted-foreground">Deleted {item.deletedAt ? new Date(item.deletedAt).toLocaleString() : "recently"} · permanent deletion in {daysRemaining} day{daysRemaining === 1 ? "" : "s"}</p></div>
              <div className="flex shrink-0 items-center gap-1"><Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => onRestore(item.id)}><ArchiveRestore className="h-3.5 w-3.5" /> Restore</Button>
              <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /> Delete permanently</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Permanently delete “{item.name}”?</AlertDialogTitle><AlertDialogDescription>This cannot be undone. The {itemLabel} and its configuration will be removed immediately.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => onDelete(item.id)}>Delete permanently</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
            </div>;
          })}</div>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
};
