'use client'

import { useActionState } from "react";
import { onboarding, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null }

export default function OnboardingPage() {
    const [state, formAction, isPending] = useActionState(onboarding, initialState)
    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <h1 className="text-2xl font-bold text-center p-10">Create Your Alliance</h1>
            {state.error && <p className="text-red-500 mb-4">{state.error}</p>}
            <form className="flex w-full max-w-md flex-col gap-2" action={formAction}>
                <input className="border border-gray-300 rounded-md p-2" maxLength={20} required type="text" name="allianceName" aria-label="Alliance Name" placeholder="Alliance Name" />
                <input className="border border-gray-300 rounded-md p-2" maxLength={7} required type="text" inputMode="numeric" name="allianceServerNumber" aria-label="Alliance Server Number" placeholder="Alliance Server Number" />
                <button className="bg-blue-500 text-white rounded-md p-2" type="submit" disabled={isPending}>
                    {isPending ? 'Creating...' : 'Onboard'}
                </button>
            </form>
        </div>
    )
}

/** *
 * User visits /onboarding
    ↓
Authenticated?
    ↓
Has memberships?
    ↓
No
    ↓
Render form
    ↓
Submit
    ↓
Validate input
    ↓
Alliance exists?
 * 
YES 
Stay on page
Show:
"An alliance with that name already exists on this server."
 * 
NO
Create Alliance
Create OWNER Membership
Redirect /app
 * 

Existing memberships -> /app
New alliance creator -> OWNER
No auto-join existing alliances
 * / */