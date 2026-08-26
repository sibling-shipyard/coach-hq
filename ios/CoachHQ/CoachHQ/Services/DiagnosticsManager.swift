import Foundation
import Sentry

struct TimelineEvent: Codable, Equatable {
    let id: UUID
    let timestamp: Date
    let message: String
    
    init(id: UUID = UUID(), timestamp: Date = Date(), message: String) {
        self.id = id
        self.timestamp = timestamp
        self.message = message
    }
}

class TimelineBuffer {
    static let shared = TimelineBuffer()
    private let maxEvents = 200
    private let maxAge: TimeInterval = 24 * 60 * 60
    private let maxSizeBytes = 256 * 1024
    
    private let queue = DispatchQueue(label: "com.coachhq.timelinebuffer")
    
    private var events: [TimelineEvent] = []
    
    private var fileURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("timeline.json")
    }
    
    init() {
        if let data = try? Data(contentsOf: fileURL),
           let loaded = try? JSONDecoder().decode([TimelineEvent].self, from: data) {
            self.events = loaded
        }
    }
    
    func addEvent(_ message: String, timestamp: Date = Date()) {
        queue.sync {
            let event = TimelineEvent(timestamp: timestamp, message: message)
            events.append(event)
            enforceLimits()
            save()
        }
    }
    
    func getEvents() -> [TimelineEvent] {
        return queue.sync {
            enforceLimits()
            return events
        }
    }
    
    func clearOnSignOut() {
        queue.sync {
            events.removeAll()
            try? FileManager.default.removeItem(at: fileURL)
        }
    }
    
    private func save() {
        if let data = try? JSONEncoder().encode(events) {
            try? data.write(to: fileURL)
        }
    }
    
    private func enforceLimits() {
        let cutoff = Date().addingTimeInterval(-maxAge)
        events = events.filter { $0.timestamp > cutoff }
        
        if events.count > maxEvents {
            events = Array(events.suffix(maxEvents))
        }
        
        while let data = try? JSONEncoder().encode(events), data.count > maxSizeBytes, !events.isEmpty {
            events.removeFirst()
        }
    }
}
