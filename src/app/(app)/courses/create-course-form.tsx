"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createCourseAction, type CreateCourseState } from "./actions";

export function CreateCourseForm() {
  const [state, action, pending] = useActionState<CreateCourseState, FormData>(createCourseAction, {
    error: null,
  });

  return (
    <form action={action} className="flex flex-col gap-2 sm:max-w-md">
      <Label htmlFor="course-name">New course (a university module, for example Analysis I)</Label>
      <div className="flex gap-2">
        <Input id="course-name" name="name" required maxLength={100} placeholder="Course name" />
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create"}
        </Button>
      </div>
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
