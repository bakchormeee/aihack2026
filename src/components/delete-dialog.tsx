"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}

/**
 * "Delete course" / "Delete sheet": a button that opens a dialog saying what goes with
 * the item (see deleteSentence), then Cancel or Delete. Delete runs `action`, which
 * moves the item to the bin and redirects.
 */
export function DeleteDialog({
  label,
  sentence,
  action,
}: {
  label: string;
  sentence: string;
  action: () => Promise<void>;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{label}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}?</DialogTitle>
          <DialogDescription>{sentence}</DialogDescription>
        </DialogHeader>
        <form action={action}>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <DeleteButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
