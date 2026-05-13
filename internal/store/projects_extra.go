package store

func (s *Store) DeletePipeline(pipelineID string) error {
	_, err := s.db.Exec(`DELETE FROM pipelines WHERE id=?`, pipelineID)
	return err
}

func (s *Store) PatchProject(key string, archived *bool, description *string) (Project, bool, error) {
	p, ok, err := s.GetProject(key)
	if err != nil || !ok {
		return Project{}, ok, err
	}
	ar := p.Archived
	desc := p.Description
	if archived != nil {
		if *archived {
			ar = 1
		} else {
			ar = 0
		}
	}
	if description != nil {
		desc = *description
	}
	_, err = s.db.Exec(`UPDATE projects SET archived=?, description=? WHERE id=?`, ar, desc, p.ID)
	if err != nil {
		return Project{}, false, err
	}
	p.Archived = ar
	p.Description = desc
	return p, true, nil
}
