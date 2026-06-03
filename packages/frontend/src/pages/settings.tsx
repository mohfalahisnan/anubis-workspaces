/**
 * Temporary stub. The full Settings page (Chrome extension pairing
 * section + chromePath input) lands in Task 19 of the chrome-extension
 * implementation plan. Until then this renders a placeholder so the
 * frontend typechecks while the backend infrastructure lands.
 */
export function SettingsPage() {
  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[860px] px-7 pt-7'>
        <h1 className='text-[28px] font-semibold leading-[1.1] tracking-[-0.025em]'>
          Settings
        </h1>
        <p className='mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground'>
          Settings is temporarily unavailable while the Chrome extension
          pairing UI lands. The Chrome profile picker has been removed
          (Chrome 136+ blocks the approach it relied on).
        </p>
      </div>
    </div>
  )
}
