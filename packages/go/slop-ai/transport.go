package slop

// Connection represents a connected SLOP consumer.
// Transports implement this interface to bridge the wire protocol.
type Connection interface {
	Send(msg any) error
	Close() error
}
