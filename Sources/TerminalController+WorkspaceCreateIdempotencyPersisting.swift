import Foundation
import OSLog

let workspaceCreateIdempotencyLogger = Logger(
    subsystem: "app.w3dev.cmux",
    category: "WorkspaceCreateIdempotency"
)

extension TerminalController {
    protocol WorkspaceCreateIdempotencyPersisting: Sendable {
        func loadOperationIDs() throws -> [UUID]
        func saveOperationIDs(_ operationIDs: [UUID]) throws
    }
}
