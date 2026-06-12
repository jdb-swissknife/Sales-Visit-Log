import { useGetVisit, useCreateNote, useUploadMedia, getGetVisitQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { useState, useRef } from "react";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, MapPin, Calendar, User, Phone, Image as ImageIcon, FileAudio, FileText, Send, Paperclip, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { TranscriptionCard } from "@/components/transcription-card";

export default function VisitDetail() {
  const params = useParams();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newNoteText, setNewNoteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  const { data: visit, isLoading } = useGetVisit(id, {
    query: { enabled: !!id, queryKey: getGetVisitQueryKey(id) }
  });

  const createNote = useCreateNote();
  const uploadMedia = useUploadMedia();

  const handleAddNote = () => {
    if (!newNoteText.trim()) return;
    
    createNote.mutate(
      { id, data: { type: "text", content: newNoteText } },
      {
        onSuccess: () => {
          setNewNoteText("");
          queryClient.invalidateQueries({ queryKey: getGetVisitQueryKey(id) });
        }
      }
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    let type: "image" | "document" | "voice_note" | "interview" = "document";
    if (file.type.startsWith("image/")) type = "image";
    else if (file.type.startsWith("audio/")) type = "voice_note";
    
    // Note: useUploadMedia expects multipart/form-data.
    // Based on the generated types, it expects `{ params: { id }, data: UploadMediaBody }`
    // UploadMediaBody is `{ file: Blob, type: string, caption?: string }`
    uploadMedia.mutate(
      { id, data: { file, type } },
      {
        onSuccess: () => {
          toast({ title: "Media uploaded" });
          queryClient.invalidateQueries({ queryKey: getGetVisitQueryKey(id) });
          if (fileInputRef.current) fileInputRef.current.value = "";
        },
        onError: () => {
          toast({ title: "Failed to upload media", variant: "destructive" });
        },
        onSettled: () => {
          setIsUploading(false);
        }
      }
    );
  };

  if (isLoading) return <div className="p-8 animate-pulse space-y-4"><div className="h-8 bg-muted rounded w-1/4"></div></div>;
  if (!visit) return <div>Visit not found</div>;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/businesses/${visit.businessId}`} className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to Business
        </Link>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-1">{visit.businessName}</h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {format(parseISO(visit.visitedAt), "PPP 'at' p")}
              </div>
            </div>
          </div>
          
          <Badge variant={
            visit.outcome === 'positive' ? 'default' :
            visit.outcome === 'negative' ? 'destructive' :
            visit.outcome === 'follow_up_needed' ? 'outline' : 'secondary'
          } className="uppercase text-xs px-3 py-1 w-fit">
            {visit.outcome.replace(/_/g, " ")}
          </Badge>
        </div>

        {(visit.contactName || visit.contactPhone || visit.nextActionDate) && (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 py-4 border-t border-border">
            {visit.contactName && (
              <div className="flex items-start gap-2 text-sm">
                <User className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <span className="font-medium block">Contact</span>
                  <span className="text-muted-foreground">{visit.contactName}</span>
                </div>
              </div>
            )}
            {visit.contactPhone && (
              <div className="flex items-start gap-2 text-sm">
                <Phone className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <span className="font-medium block">Phone</span>
                  <a href={`tel:${visit.contactPhone}`} className="text-primary hover:underline">{visit.contactPhone}</a>
                </div>
              </div>
            )}
            {visit.nextActionDate && (
              <div className="flex items-start gap-2 text-sm">
                <Calendar className="h-4 w-4 mt-0.5 text-accent" />
                <div>
                  <span className="font-medium block">Next Action</span>
                  <span className="text-accent font-medium">{format(parseISO(visit.nextActionDate), "MMM d, yyyy")}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
          <h2 className="text-lg font-bold">Field Notes</h2>

          {/* AI transcriptions for voice media */}
          {visit.media
            ?.filter((m) => m.type === "voice_note" || m.type === "interview")
            .map((m) => (
              <TranscriptionCard key={`transcription-${m.id}`} media={m} />
            ))}

          {/* Notes Feed */}
          <div className="space-y-4">
            {visit.notes?.map((note) => (
              <Card key={note.id} className="bg-card shadow-sm border-l-2 border-l-primary/50">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span className="flex items-center gap-1">
                      {note.type === 'voice' ? <FileAudio className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                      {note.type === 'voice' ? 'Voice Note' : 'Text Note'}
                    </span>
                    <span>{format(parseISO(note.createdAt), "h:mm a")}</span>
                  </div>
                  
                  {note.type === 'text' && note.content && (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{note.content}</p>
                  )}
                  
                  {note.type === 'voice' && note.audioUrl && (
                    <div className="mt-2 bg-muted/50 rounded p-2">
                      <audio controls src={note.audioUrl} className="w-full h-8" />
                      {note.durationSeconds && <span className="text-xs text-muted-foreground block mt-1">Duration: {note.durationSeconds}s</span>}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Add Note inline */}
          <div className="mt-6 flex flex-col gap-2 relative">
            <Textarea 
              placeholder="Add a text note from the field..." 
              value={newNoteText}
              onChange={(e) => setNewNoteText(e.target.value)}
              className="min-h-[80px] bg-background resize-none pr-12"
            />
            <Button 
              size="sm" 
              className="absolute bottom-2 right-2 h-8 w-8 p-0 rounded-full" 
              onClick={handleAddNote}
              disabled={!newNoteText.trim() || createNote.isPending}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Media Gallery</h2>
            <div>
              <Input
                type="file"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept="image/*,audio/*,video/*,.pdf"
              />
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Paperclip className="h-4 w-4 mr-1" />}
                Add
              </Button>
            </div>
          </div>
          
          {visit.media && visit.media.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {visit.media.map(item => (
                <div key={item.id} className="relative group rounded-md overflow-hidden border border-border bg-muted aspect-square">
                  {item.type === 'image' ? (
                    <img src={item.url} alt={item.caption || 'Media'} className="object-cover w-full h-full" />
                  ) : item.type === 'voice_note' || item.type === 'interview' ? (
                     <div className="flex flex-col items-center justify-center h-full p-2 bg-background">
                       <FileAudio className="h-8 w-8 mb-2 text-primary" />
                       <audio controls src={item.url} className="w-full h-8 max-w-full" />
                       <span className="text-[10px] text-center mt-1 truncate w-full" title={item.filename}>{item.filename}</span>
                     </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground bg-background">
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center hover:text-primary">
                        <FileText className="h-8 w-8 mb-2" />
                        <span className="text-[10px] text-center px-2 truncate w-full" title={item.filename}>{item.filename}</span>
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 bg-muted/30 border border-dashed border-border rounded-md text-sm text-muted-foreground">
              No media attached.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
