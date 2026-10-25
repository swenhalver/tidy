/**
 * Type-only guard: each local replacement must accept every call the bundled web
 * code makes to the module it replaces. Upstream signature changes then fail
 * `typecheck` here instead of silently misbehaving at runtime. Missing exports
 * already fail the bundle build.
 */
import type * as WebDocuments from "@/lib/design/document-service";
import type * as WebFiles from "@/lib/design/service";
import type * as WebFolders from "@/lib/design/folder-service";
import type * as WebImages from "@/lib/design/file-image";
import type * as Documents from "./document-service";
import type * as Files from "./service";
import type * as Folders from "./folder-service";
import type * as Images from "./file-image";

type Accepts<
  Web extends (...args: never[]) => unknown,
  Local extends (...args: never[]) => unknown,
> = Parameters<Web> extends Parameters<Local> ? true : false;

export const contract = {
  abortImport: true as Accepts<typeof WebDocuments.abortImport, typeof Documents.abortImport>,
  appendBasicNodes: true as Accepts<
    typeof WebDocuments.appendBasicNodes,
    typeof Documents.appendBasicNodes
  >,
  commitImport: true as Accepts<typeof WebDocuments.commitImport, typeof Documents.commitImport>,
  createImport: true as Accepts<typeof WebDocuments.createImport, typeof Documents.createImport>,
  ensureEditorDocument: true as Accepts<
    typeof WebDocuments.ensureEditorDocument,
    typeof Documents.ensureEditorDocument
  >,
  getDocument: true as Accepts<typeof WebDocuments.getDocument, typeof Documents.getDocument>,
  getDocumentPage: true as Accepts<
    typeof WebDocuments.getDocumentPage,
    typeof Documents.getDocumentPage
  >,
  getDocumentRevision: true as Accepts<
    typeof WebDocuments.getDocumentRevision,
    typeof Documents.getDocumentRevision
  >,
  getExportAssets: true as Accepts<
    typeof WebDocuments.getExportAssets,
    typeof Documents.getExportAssets
  >,
  patchDocumentNode: true as Accepts<
    typeof WebDocuments.patchDocumentNode,
    typeof Documents.patchDocumentNode
  >,
  patchDocumentNodes: true as Accepts<
    typeof WebDocuments.patchDocumentNodes,
    typeof Documents.patchDocumentNodes
  >,
  putAsset: true as Accepts<typeof WebDocuments.putAsset, typeof Documents.putAsset>,
  putImportChunk: true as Accepts<
    typeof WebDocuments.putImportChunk,
    typeof Documents.putImportChunk
  >,
  putImportDocument: true as Accepts<
    typeof WebDocuments.putImportDocument,
    typeof Documents.putImportDocument
  >,
  validateImport: true as Accepts<
    typeof WebDocuments.validateImport,
    typeof Documents.validateImport
  >,
  createDesignFileForUser: true as Accepts<
    typeof WebFiles.createDesignFileForUser,
    typeof Files.createDesignFileForUser
  >,
  getDesignFile: true as Accepts<typeof WebFiles.getDesignFile, typeof Files.getDesignFile>,
  listDesignFiles: true as Accepts<typeof WebFiles.listDesignFiles, typeof Files.listDesignFiles>,
  listDesignOrganizations: true as Accepts<
    typeof WebFiles.listDesignOrganizations,
    typeof Files.listDesignOrganizations
  >,
  renameDesignFileForUser: true as Accepts<
    typeof WebFiles.renameDesignFileForUser,
    typeof Files.renameDesignFileForUser
  >,
  listDesignFolders: true as Accepts<
    typeof WebFolders.listDesignFolders,
    typeof Folders.listDesignFolders
  >,
  createDesignFolderForUser: true as Accepts<
    typeof WebFolders.createDesignFolderForUser,
    typeof Folders.createDesignFolderForUser
  >,
  renameDesignFolderForUser: true as Accepts<
    typeof WebFolders.renameDesignFolderForUser,
    typeof Folders.renameDesignFolderForUser
  >,
  moveDesignFileForUser: true as Accepts<
    typeof WebFolders.moveDesignFileForUser,
    typeof Folders.moveDesignFileForUser
  >,
  deleteDesignFolderForUser: true as Accepts<
    typeof WebFolders.deleteDesignFolderForUser,
    typeof Folders.deleteDesignFolderForUser
  >,
  getFileImage: true as Accepts<typeof WebImages.getFileImage, typeof Images.getFileImage>,
} satisfies Record<string, true>;
