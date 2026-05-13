import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { ScheduledTask } from "./types.js"

const DEFAULT_JOBS_FILE = "./data/scheduled-tasks.json"

function getJobsFilePath(): string {
  return process.env["RELIABILITY_SCHEDULED_TASKS_JOBS_FILE"] ?? DEFAULT_JOBS_FILE
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

async function readTasks(): Promise<ScheduledTask[]> {
  const jobsFile = getJobsFilePath()
  try {
    const data = await fs.readFile(jobsFile, "utf-8")
    const parsed = JSON.parse(data)
    return Array.isArray(parsed) ? parsed : parsed.tasks ?? []
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return []
    }
    throw e
  }
}

async function writeTasks(tasks: ScheduledTask[]): Promise<void> {
  const jobsFile = getJobsFilePath()
  const dir = path.dirname(jobsFile)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(jobsFile, JSON.stringify({ tasks }, null, 2), "utf-8")
}

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  return readTasks()
}

export async function addScheduledTask(
  task: Omit<ScheduledTask, "id"> & { id?: string }
): Promise<ScheduledTask> {
  const tasks = await readTasks()
  const newTask: ScheduledTask = {
    ...task,
    id: task.id ?? generateId(),
  } as ScheduledTask
  tasks.push(newTask)
  await writeTasks(tasks)
  return newTask
}

export async function removeScheduledTask(id: string): Promise<boolean> {
  const tasks = await readTasks()
  const index = tasks.findIndex((t) => t.id === id)
  if (index === -1) {
    return false
  }
  tasks.splice(index, 1)
  await writeTasks(tasks)
  return true
}

export async function updateScheduledTask(
  id: string,
  updater: (task: ScheduledTask) => Partial<ScheduledTask>
): Promise<ScheduledTask | null> {
  const tasks = await readTasks()
  const index = tasks.findIndex((t) => t.id === id)
  if (index === -1) {
    return null
  }
  const currentTask = tasks[index]!
  const updated = updater(currentTask)
  const merged: ScheduledTask = { ...currentTask, ...updated }
  tasks[index] = merged
  await writeTasks(tasks)
  return merged
}
