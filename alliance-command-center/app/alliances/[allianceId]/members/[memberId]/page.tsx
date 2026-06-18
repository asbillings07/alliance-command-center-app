import { notFound } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { formatPower } from "@/app/src/lib/formatPower";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireMembershipAccess } from "@/app/src/lib/auth/requireMembershipAccess";
import { LeadershipNoteCard } from "./LeadershipNoteCard";

type Params = {
    params: Promise<{
        allianceId: string;
        memberId: string;
    }>
}

export default async function MemberPage({ params }: Params) {
    const { allianceId, memberId } = await params;
    const user = await requireAuth();
    const { member } = await requireMembershipAccess(memberId, user.id);

    if (member.allianceId !== allianceId) {
        notFound();
    }

    const leadershipNotes = await prisma.leadershipNote.findMany({
        where: {
            memberId: memberId,
        },
        include: {
            author: {
                select: {
                    id: true,
                    displayName: true,
                },
            },
        },
        orderBy: {
            createdAt: "desc",
        },
    })


return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
        <section className="flex flex-col items-center justify-center">
            <div className="text-2xl font-bold p-5">Member Overview</div>
            <h1 className="text-xl font-bold">Member: {member.playerName}</h1>
            <div className="text-sm text-gray-500">THP: {member.thp == null ? "—" : formatPower(member.thp)}</div>
            <div className="text-sm text-gray-500">Top Squad: {member.squadPower == null ? "—" : formatPower(member.squadPower)}</div>
        </section>
        <section className="flex flex-col gap-4">
            <div className="text-2xl font-bold p-5 self-center">Leadership Notes</div>
            <LeadershipNoteCard memberId={member.id} mode="create" />
            {leadershipNotes.length > 0 ? (
                leadershipNotes.map((note) => (
                    <LeadershipNoteCard
                        key={note.id}
                        memberId={member.id}
                        mode="view"
                        note={{
                            id: note.id,
                            content: note.content,
                            noteKey: `${note.id}-${note.updatedAt.getTime()}`,
                            noteType: note.noteType,
                            authorName: note.author.displayName,
                            createdAt: note.createdAt.toLocaleDateString(),
                            isAuthor: note.author.id === user.id,
                        }}
                    />
                ))
            ) : (
                <div className="text-sm text-gray-500 text-center py-4">No leadership notes yet.</div>
            )}
        </section>
        <section className="flex flex-col items-center justify-center">
            <div className="text-2xl font-bold p-5">Member Participation Metrics (Coming soon)</div>
        </section>
    </div>
)
}
