import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { WorkflowGallery } from './gallery'
import { WorkflowWiredFlow } from './wired-flow'

export function WorkflowDemoPage() {
  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <div className='border-b border-border px-6 py-4'>
        <p className='text-xs uppercase tracking-[0.3em] text-[#fd551d]'>Workflow node library</p>
        <h1 className='mt-2 text-2xl font-semibold tracking-tight'>Components + wired demo</h1>
        <p className='mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground'>
          Gallery shows each node rendered standalone with realistic data. Wired flow renders the full
          Anubis content workflow (competitor post → crawler → transformers → context builder →
          executor → review → ready) using SeparatedEdge for multi-source fan-in.
        </p>
      </div>
      <div className='min-h-0 flex-1'>
        <Tabs defaultValue='gallery' className='flex h-full min-h-0 flex-col'>
          <TabsList className='mx-6 mt-4 self-start'>
            <TabsTrigger value='gallery'>Gallery</TabsTrigger>
            <TabsTrigger value='wired'>Wired flow</TabsTrigger>
          </TabsList>
          <TabsContent value='gallery' className='min-h-0 flex-1 overflow-auto'>
            <WorkflowGallery />
          </TabsContent>
          <TabsContent value='wired' className='min-h-0 flex-1'>
            <WorkflowWiredFlow />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
